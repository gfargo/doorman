import { GoogleAuth } from 'google-auth-library'
import { logger } from '../../logger'
import { BaseFirewallClient } from '../BaseFirewallClient'
import type { CloudArmorOperation, CloudArmorRule, CloudArmorSecurityPolicy } from '../../types/gcp'

// Overridable for testing/demos against a local mock server — never set this
// in production. Same seam as DOORMAN_VERCEL_API_BASE_URL/
// DOORMAN_FASTLY_API_BASE_URL; demos/cloudarmor-mock-server.mjs relies on it.
export const GCP_COMPUTE_API_BASE_URL =
  process.env.DOORMAN_GCP_API_BASE_URL || 'https://compute.googleapis.com/compute/v1'

const COMPUTE_SCOPE = 'https://www.googleapis.com/auth/compute'

// How long to keep polling a long-running Operation before giving up. Cloud
// Armor rule mutations are typically sub-second in practice, but global
// Compute operations can occasionally take longer under load — capped well
// short of makeRequest's own per-request timeout stacking indefinitely.
const OPERATION_POLL_INTERVAL_MS = 1000
const OPERATION_POLL_TIMEOUT_MS = 60000

/**
 * A client for Google Cloud Armor's `securityPolicies` REST API
 * (`https://compute.googleapis.com/compute/v1/projects/{project}/global/...`).
 * REST-with-header-auth, so this extends `BaseFirewallClient` like
 * Vercel/Cloudflare/Fastly's clients — the one real difference is that
 * `getAuthHeaders()` is genuinely async here (see BaseFirewallClient's own
 * doc comment on why that method is async at all): GCP's OAuth2 access
 * token is short-lived and fetched fresh per request via `google-auth-
 * library`'s `GoogleAuth`, which handles caching/refresh internally.
 *
 * Every mutating `securityPolicies` method (`addRule`/`patchRule`/
 * `removeRule`) returns a long-running Operation rather than the updated
 * resource — `waitForOperation` polls it internally so every public method
 * here still presents the same "await and it's done" shape the other three
 * providers' clients already have, rather than leaking GCP's async-operation
 * model into the service layer.
 */
export class CloudArmorClient extends BaseFirewallClient {
  private readonly auth: GoogleAuth
  /** Exposed (unlike policyName) — CloudArmorFirewallService.fetchConfig needs it for the providers.gcp config block. */
  public readonly projectId: string
  private readonly policyName: string

  constructor(projectId: string, policyName: string, serviceAccountKeyPath?: string) {
    super(`${GCP_COMPUTE_API_BASE_URL}/projects/${projectId}/global`, 'gcp')
    this.projectId = projectId
    this.policyName = policyName
    this.auth = new GoogleAuth({
      scopes: [COMPUTE_SCOPE],
      // Omitting keyFile entirely (rather than passing undefined) lets
      // GoogleAuth run its own full Application Default Credentials
      // resolution (GOOGLE_APPLICATION_CREDENTIALS env var, gcloud user
      // creds, or the GCE/Cloud Run metadata server) exactly as it would
      // with no config at all — confirmed via research on #187.
      ...(serviceAccountKeyPath ? { keyFile: serviceAccountKeyPath } : {}),
    })
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    const client = await this.auth.getClient()
    const headers = await client.getRequestHeaders()
    // getRequestHeaders() returns a real WHATWG Headers instance, not a
    // plain object. BaseFirewallClient.makeRequest merges auth headers by
    // object-spreading this return value into a header literal — spreading
    // a Headers instance produces `{}`, silently dropping every header
    // (including Authorization) from every real request. Converting via
    // entries() is required, not optional.
    return Object.fromEntries(headers.entries())
  }

  private policyPath(...segments: string[]): string {
    return ['/securityPolicies', this.policyName, ...segments].join('/')
  }

  async getPolicy(): Promise<CloudArmorSecurityPolicy> {
    return this.get<CloudArmorSecurityPolicy>(this.policyPath())
  }

  async addRule(rule: CloudArmorRule): Promise<void> {
    const operation = await this.post<CloudArmorOperation>(this.policyPath('addRule'), rule)
    await this.waitForOperation(operation)
  }

  async patchRule(priority: number, rule: CloudArmorRule): Promise<void> {
    const operation = await this.post<CloudArmorOperation>(`${this.policyPath('patchRule')}?priority=${priority}`, rule)
    await this.waitForOperation(operation)
  }

  async removeRule(priority: number): Promise<void> {
    const operation = await this.post<CloudArmorOperation>(`${this.policyPath('removeRule')}?priority=${priority}`)
    await this.waitForOperation(operation)
  }

  /**
   * Polls a long-running Operation until it reaches `DONE`, then throws if
   * it completed with an error. `securityPolicies` mutators are project-
   * scoped, so the operation lives at `/global/operations/{name}` — the
   * same base path every other method here already targets.
   */
  private async waitForOperation(operation: CloudArmorOperation): Promise<void> {
    const deadline = Date.now() + OPERATION_POLL_TIMEOUT_MS
    let current = operation

    while (current.status !== 'DONE') {
      if (Date.now() >= deadline) {
        throw new Error(
          `gcp operation "${current.name}" did not complete within ${OPERATION_POLL_TIMEOUT_MS}ms (last status: ${current.status})`,
        )
      }
      await this.delay(OPERATION_POLL_INTERVAL_MS)
      current = await this.get<CloudArmorOperation>(`/operations/${current.name}`)
    }

    if (current.httpErrorStatusCode || current.error) {
      const messages = current.error?.errors?.map((e) => e.message).join(', ') || current.httpErrorMessage
      throw new Error(`gcp operation "${current.name}" failed: ${messages || 'unknown error'}`)
    }

    if (current.warnings?.length) {
      current.warnings.forEach((w) => logger.warn(`gcp operation "${current.name}" warning: ${w.message}`))
    }
  }

  /**
   * Verify credentials are valid by attempting to fetch the policy.
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.getPolicy()
      return true
    } catch (error) {
      logger.debug('Credential verification failed:', error)
      return false
    }
  }
}
