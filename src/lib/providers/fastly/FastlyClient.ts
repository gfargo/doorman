import { logger } from '../../logger'
import { BaseFirewallClient } from '../BaseFirewallClient'
import type {
  FastlyRule,
  FastlyRuleInput,
  FastlyRulesResponse,
  FastlyList,
  FastlyListsResponse,
  FastlyWorkspace,
} from '../../types/fastly'

// Overridable for testing/demos against a local mock server — never set this
// in production. demos/fastly-mock-server.mjs relies on this to drive the
// real CLI/network code path against a local fixture server instead of the
// live Fastly API, the same seam VercelClient's DOORMAN_VERCEL_API_BASE_URL
// provides.
export const FASTLY_API_BASE_URL = process.env.DOORMAN_FASTLY_API_BASE_URL || 'https://api.fastly.com'

/** Name/type of the two lists doorman maintains for IP allow/block-listing — see `translator.ts`'s IP-list note. */
export const DOORMAN_DENY_LIST_NAME = 'doorman-managed-deny'
export const DOORMAN_ALLOW_LIST_NAME = 'doorman-managed-allow'

/**
 * A client for interacting with Fastly's Next-Gen WAF API
 * (`https://api.fastly.com/ngwaf/v1/...`). REST-with-header-auth, so this
 * extends `BaseFirewallClient` the same way Vercel/Cloudflare's clients do —
 * confirmed against go-fastly's `Client` (single `Fastly-Key` header, no
 * request signing), resolving the "open question" issue #186 flagged about
 * whether Fastly would actually fit this base class.
 */
export class FastlyClient extends BaseFirewallClient {
  constructor(
    private workspaceId: string,
    private apiToken: string,
  ) {
    super(FASTLY_API_BASE_URL, 'fastly')
  }

  protected async getAuthHeaders(): Promise<Record<string, string>> {
    return {
      'Fastly-Key': this.apiToken,
    }
  }

  private workspacePath(...segments: string[]): string {
    return ['/ngwaf/v1/workspaces', this.workspaceId, ...segments].join('/')
  }

  /**
   * Fetches every rule in the workspace.
   *
   * Fastly paginates `list` responses (`meta.limit`/`meta.total`), which
   * this doesn't yet follow — acceptable for the rule volumes doorman
   * targets today (`BaseFirewallService.validateRuleCount` already warns
   * well before a workspace would need a second page), but a workspace with
   * more rules than a single page returns would see only the first page.
   */
  async fetchRules(): Promise<FastlyRule[]> {
    const response = await this.get<FastlyRulesResponse>(this.workspacePath('rules'))
    return response.data
  }

  // Creating a rule is not idempotent — a retry after a response is lost
  // (the request reached Fastly and created the rule, but the client never
  // saw the success) creates a second, duplicate rule with a new
  // server-assigned id. updateRule/deleteRule are keyed by id and safe to
  // retry. Same bug, same fix, as Vercel's rules.insert — see #195.
  async createRule(rule: FastlyRuleInput): Promise<FastlyRule> {
    return this.post<FastlyRule>(this.workspacePath('rules'), rule, { retries: 0 })
  }

  async updateRule(ruleId: string, rule: FastlyRuleInput): Promise<FastlyRule> {
    return this.patch<FastlyRule>(this.workspacePath('rules', ruleId), rule)
  }

  async deleteRule(ruleId: string): Promise<void> {
    await this.delete<void>(this.workspacePath('rules', ruleId))
  }

  async fetchLists(): Promise<FastlyList[]> {
    const response = await this.get<FastlyListsResponse>(this.workspacePath('lists'))
    return response.data
  }

  // Same non-idempotency as createRule above — a lost-response retry would
  // create a second list also named DOORMAN_DENY_LIST_NAME/
  // DOORMAN_ALLOW_LIST_NAME, and findList's `lists.find(...)` would then
  // silently pick whichever one happens to sort first.
  async createList(name: string, entries: string[]): Promise<FastlyList> {
    return this.post<FastlyList>(
      this.workspacePath('lists'),
      {
        name,
        type: 'ip',
        description: 'Managed by doorman — do not edit entries directly, they will be overwritten on the next sync.',
        entries,
      },
      { retries: 0 },
    )
  }

  async updateListEntries(listId: string, entries: string[]): Promise<FastlyList> {
    return this.patch<FastlyList>(this.workspacePath('lists', listId), { entries })
  }

  /**
   * Finds doorman's managed list by name, without creating it — for
   * read-only callers (`fetchConfig`/`getChanges`). A missing list reads as
   * "no entries yet", same as `VercelClient`'s `emptyConfigPlaceholder`:
   * never create as a side effect of what's supposed to be a read.
   */
  async findList(name: string): Promise<FastlyList | null> {
    const lists = await this.fetchLists()
    return lists.find((l) => l.name === name && l.type === 'ip') ?? null
  }

  /**
   * Finds doorman's managed list by name, creating it (empty) if it
   * doesn't exist yet — the same find-or-create pattern
   * `CloudflareClient.getOrCreateFirewallRuleset`/`getOrCreateIPBlocklist`
   * use for their own doorman-managed container resources. Only called
   * from the real (non-dry-run) sync write path — see `findList` for the
   * read-only equivalent.
   */
  async getOrCreateList(name: string): Promise<FastlyList> {
    const existing = await this.findList(name)
    if (existing) {
      return existing
    }
    logger.debug(`Creating Fastly list "${name}" in workspace ${this.workspaceId}`)
    return this.createList(name, [])
  }

  async fetchWorkspace(): Promise<FastlyWorkspace> {
    return this.get<FastlyWorkspace>(this.workspacePath())
  }

  /**
   * Verify credentials are valid by attempting to fetch the workspace.
   */
  async verifyCredentials(): Promise<boolean> {
    try {
      await this.fetchWorkspace()
      return true
    } catch (error) {
      logger.debug('Credential verification failed:', error)
      return false
    }
  }
}
