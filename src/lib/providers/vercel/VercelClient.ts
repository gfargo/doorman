import chalk from 'chalk'
import { logger } from '../../logger'
import { CustomRule, IPBlockingRule } from '../../types/vercel'
import type { FirewallConfig } from '../../types'
import { prompt } from '../../ui/prompt'
import { createEmptyConfig } from '../../utils/createEmptyConfig'
import { BaseFirewallClient } from '../BaseFirewallClient'

export type ApiResponse = LatestConfigResponse | TargetVersionConfig

export type TargetVersionConfig = VercelConfig

export type LatestConfigResponse = {
  active: VercelConfig
}

export interface VercelConfig {
  version: number
  id: string
  firewallEnabled: boolean
  crs: unknown // TODO: Add type for CRS, this is an enterprise feature and less clear how to interact with :(
  rules: CustomRule[]
  ips: IPBlockingRule[]
  projectKey: string
  ownerId: string
  updatedAt: string
}

// Overridable for testing/demos against a local mock server — never set this
// in production. demos/mock-server.mjs and the VHS demo tapes rely on this
// to drive the real CLI/network code path against a local fixture server
// instead of the live Vercel API.
export const VERCEL_API_BASE_URL =
  process.env.DOORMAN_VERCEL_API_BASE_URL || 'https://api.vercel.com/v1/security/firewall/config'

export interface FetchFirewallConfigOptions {
  /**
   * Whether a missing firewall configuration may be created on the caller's
   * behalf — i.e. whether it's OK to prompt "Would you like to create one?"
   * and, if confirmed, issue the mutating PUT that creates an empty config.
   *
   * Defaults to `true`, preserving the original create-on-first-use
   * behavior for real syncs. Read-only callers (e.g. dry-run validation)
   * MUST pass `false` so a project with no firewall config yet never
   * triggers an interactive prompt (which hangs with no TTY, e.g. in CI)
   * or a real write during what's supposed to be a side-effect-free
   * operation.
   */
  allowCreate?: boolean
}

/**
 * A client for interacting with the Vercel API to manage firewall rules.
 */
export class VercelClient extends BaseFirewallClient {
  /**
   * Creates an instance of VercelClient.
   * @param projectId - The ID of the Vercel project.
   * @param teamId - The ID of the Vercel team. Omit for a personal (non-team) account.
   * @param token - The authentication token for the Vercel API.
   */
  constructor(
    private projectId: string,
    private teamId: string | undefined,
    private token: string,
  ) {
    // No static base path because URLs are constructed per-request with query params
    super('', 'vercel')
  }

  /**
   * Generates the headers required for the Vercel API requests.
   * @returns An object containing the headers.
   */
  protected async getAuthHeaders(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${this.token}`,
    }
  }

  /**
   * Constructs the URL for the Vercel API requests.
   * @returns The constructed URL.
   */
  private getUrl(configVersion?: number): string {
    const baseUrl = configVersion !== undefined ? `${VERCEL_API_BASE_URL}/${configVersion}` : VERCEL_API_BASE_URL
    logger.debug('API URL:', baseUrl)
    // teamId is omitted entirely (not sent as an empty/`undefined` literal)
    // when absent. Every Vercel account — including a Hobby account — is a
    // team with its own Team ID; omitting the param doesn't mean "no team",
    // it tells Vercel to resolve the request against the token's *default*
    // team. Only matters if the caller belongs to more than one team.
    const teamParam = this.teamId ? `&teamId=${this.teamId}` : ''
    return `${baseUrl}?projectId=${this.projectId}${teamParam}`
  }

  // Note: response handling is centralized in BaseFirewallClient.makeRequest

  /**
   * Fetches the firewall config for the Vercel project.
   * @param configVersion - Optional version number to fetch a specific config version
   * @returns A promise that resolves to the firewall config.
   * @throws An error if the fetch request fails.
   */
  async fetchFirewallConfig(configVersion?: number, options?: FetchFirewallConfigOptions): Promise<VercelConfig> {
    const { allowCreate = true } = options ?? {}
    const response = await this.get<ApiResponse>(this.getUrl(configVersion))

    logger.debug('Config Version:', configVersion ?? 'latest')
    logger.debug('Fetched Config:', configVersion ? response : (response as LatestConfigResponse).active)

    if (configVersion) {
      return response as TargetVersionConfig
    }

    if (!response || ('active' in response && response.active === null)) {
      logger.warn(chalk.bold('No firewall configuration found.'))

      if (!allowCreate) {
        // Read-only fetch (e.g. dry-run validation) — never prompt or
        // mutate remote state. Return a synthetic empty config so diffing
        // logic still has something to compare against.
        logger.debug('Skipping create-configuration prompt for read-only fetch.')
        return this.emptyConfigPlaceholder()
      }

      const createEmptyFirstVersion = await prompt('Would you like to create one?', {
        type: 'confirm',
      })

      if (createEmptyFirstVersion) {
        logger.debug('Creating new empty firewall configuration...')
        const initialVersion = await this.putEmptyConfig()
        logger.debug('Empty firewall configuration created successfully')
        logger.debug(`New configuration version: ${chalk.yellow(initialVersion.version)}`)

        return initialVersion
      } else {
        return (response as LatestConfigResponse).active
      }
    }

    return (response as LatestConfigResponse).active
  }

  /**
   * A synthetic, never-persisted empty config used when a read-only caller
   * (e.g. dry-run validation) asks for the firewall config of a project
   * that doesn't have one yet, and creation is disallowed. Never sent to
   * the Vercel API.
   */
  private emptyConfigPlaceholder(): VercelConfig {
    return {
      version: 0,
      id: '',
      firewallEnabled: true,
      crs: null,
      rules: [],
      ips: [],
      projectKey: '',
      ownerId: '',
      updatedAt: new Date(0).toISOString(),
    }
  }

  async putEmptyConfig(): Promise<VercelConfig> {
    const { $schema, ...emptyConfig } = createEmptyConfig()
    logger.debug('Empty Config:', emptyConfig)
    return this.putConfig(emptyConfig)
  }

  async putConfig(config: FirewallConfig): Promise<VercelConfig> {
    const response = await this.put<LatestConfigResponse>(this.getUrl(), config)
    return response.active
  }

  /**
   * Fetches the active firewall rules for the Vercel project.
   * @returns A promise that resolves to an array of CustomRule objects.
   * @throws An error if the fetch request fails.
   */
  async fetchActiveFirewallRules(): Promise<CustomRule[]> {
    const data = await this.fetchFirewallConfig()
    return data?.rules
  }

  /**
   * Updates an existing firewall rule or creates a new one if the rule ID is not provided.
   * @param rule - The CustomRule object to update or create.
   * @returns A promise that resolves to the updated or created CustomRule object.
   * @throws An error if the update or create request fails.
   */
  async updateFirewallRule(rule: CustomRule): Promise<CustomRule> {
    const isNewRule = !rule.id || rule.id === '-'
    const body = {
      action: isNewRule ? 'rules.insert' : 'rules.update',
      id: isNewRule ? null : rule.id,
      value: {
        name: rule.name,
        description: rule.description,
        action: rule.action,
        conditionGroup: rule.conditionGroup,
        active: rule.active,
      },
    }

    // `rules.insert` is not idempotent — a retry after a response is lost
    // (e.g. a connection reset arriving after Vercel already created the
    // rule) creates a second, duplicate rule. `rules.update` is safe to
    // retry (keyed by id). See #195.
    return this.patch<CustomRule>(this.getUrl(), body, isNewRule ? { retries: 0 } : undefined)
  }

  /**
   * Creates a new firewall rule.
   * @param rule - The CustomRule object to create, without the ID.
   * @returns A promise that resolves to the created CustomRule object.
   * @throws An error if the create request fails.
   */
  async createFirewallRule(rule: Omit<CustomRule, 'id'>): Promise<CustomRule> {
    return this.updateFirewallRule({ ...rule, id: '-' } as CustomRule)
  }

  /**
   * Deletes an existing firewall rule.
   * @param rule - The CustomRule object to delete.
   * @returns A promise that resolves when the rule is deleted.
   * @throws An error if the delete request fails.
   */
  async deleteFirewallRule(rule: CustomRule): Promise<void> {
    const body = {
      action: 'rules.remove',
      id: rule.id,
      value: null,
    }

    await this.patch<void>(this.getUrl(), body)
  }

  /**
   * Updates an existing IP blocking rule or creates a new one if the rule ID is not provided.
   */
  async updateIPBlockingRule(rule: IPBlockingRule): Promise<IPBlockingRule> {
    const isNewRule = !rule.id || rule.id === '-'
    const body = {
      action: isNewRule ? 'ip.insert' : 'ip.update',
      id: isNewRule ? null : rule.id,
      value: {
        action: rule.action,
        hostname: rule.hostname,
        ip: rule.ip,
        // Always send `notes`, even when falsy. This is a partial-update-
        // style action (`ip.update`), so omitting the key when a user
        // clears their local note (leaving `rule.notes` undefined) reads
        // to Vercel's API as "leave the existing note alone" rather than
        // "clear it" — the note would silently persist remotely after a
        // sync that was supposed to remove it. An explicit `null` is
        // unambiguous either way.
        notes: rule.notes ?? null,
      },
    }

    // Same non-idempotency risk as updateFirewallRule's `rules.insert` —
    // see #195.
    return this.patch<IPBlockingRule>(this.getUrl(), body, isNewRule ? { retries: 0 } : undefined)
  }

  /**
   * Creates a new IP blocking rule.
   */
  async createIPBlockingRule(rule: Omit<IPBlockingRule, 'id'>): Promise<IPBlockingRule> {
    return this.updateIPBlockingRule({ ...rule, id: '-' })
  }

  /**
   * Deletes an existing IP blocking rule.
   */
  async deleteIPBlockingRule(rule: IPBlockingRule): Promise<void> {
    const body = {
      action: 'ip.remove',
      id: rule.id,
      value: null,
    }

    await this.patch<void>(this.getUrl(), body)
  }

  /**
   * Verify credentials are valid by attempting to fetch config
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.fetchFirewallConfig()
      return true
    } catch (error) {
      logger.debug('Credential verification failed:', error)
      return false
    }
  }
}
