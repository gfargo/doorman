import { createHash } from 'crypto'
import { BaseFirewallClient } from '../BaseFirewallClient'
import { logger } from '../../logger'
import { providerErrors, cloudflareErrors } from '../../errors'
import { CloudflareErrorHandler } from './CloudflareErrorHandler'
import { ApiCache, CacheKeys, CacheTTL } from '../../utils/cache'
import { CloudflareOptimizer } from './CloudflareOptimizer'
import type { CacheStats } from '../../utils/cache'
import type {
  CloudflareRuleset,
  CloudflareAPIResponse,
  CloudflareCreateRulesetRequest,
  CloudflareUpdateRulesetRequest,
  CloudflareCreateRuleRequest,
  CloudflareUpdateRuleRequest,
  CloudflareList,
  CloudflareListItem,
  CloudflareCreateListRequest,
  CloudflareUpdateListRequest,
  CloudflareAddListItemsRequest,
  CloudflareRemoveListItemsRequest,
  CloudflareListItemsResponse,
} from '../../types/cloudflare'

/**
 * Cloudflare API Client
 * Implements Cloudflare Ruleset Engine API operations
 */
export class CloudflareClient extends BaseFirewallClient {
  private readonly apiToken: string
  private readonly zoneId: string
  private readonly accountId?: string
  private readonly cache: ApiCache
  private readonly optimizer: CloudflareOptimizer

  constructor(apiToken: string, zoneId: string, accountId?: string) {
    super('https://api.cloudflare.com/client/v4', 'cloudflare')
    this.apiToken = apiToken
    this.zoneId = zoneId
    this.accountId = accountId
    this.cache = new ApiCache({ enableLogging: true })
    this.optimizer = new CloudflareOptimizer()
  }

  /**
   * Get cache statistics for monitoring
   */
  public getCacheStats(): CacheStats {
    return this.cache.getStats()
  }

  /**
   * Clear all cached data. Call after write operations that
   * invalidate previously cached responses.
   */
  public clearCache(): void {
    this.cache.clear()
  }

  /**
   * Invalidate cache entries related to rulesets for this zone.
   */
  private invalidateRulesetCache(): void {
    this.cache.invalidateByPrefix(`zone:${this.zoneId}`)
  }

  /**
   * Invalidate cache entries related to lists for this account.
   */
  private invalidateListCache(): void {
    if (this.accountId) {
      this.cache.invalidateByPrefix(`account:${this.accountId}`)
    }
  }

  /**
   * Get authentication headers
   */
  protected getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiToken}`,
      ...this.optimizer.getConnectionHeaders(),
    }
  }

  /**
   * Get the optimizer instance for use by the service layer.
   */
  public getOptimizer(): CloudflareOptimizer {
    return this.optimizer
  }

  /**
   * List all rulesets for the zone
   */
  public async listRulesets(): Promise<CloudflareRuleset[]> {
    logger.debug(`Fetching rulesets for zone ${this.zoneId}`)

    // Check cache first
    const cacheKey = CacheKeys.rulesets(this.zoneId)
    const cached = this.cache.get<CloudflareRuleset[]>(cacheKey)
    if (cached) {
      return cached
    }

    // Deduplicate concurrent requests for the same rulesets
    const dedupKey = CloudflareOptimizer.requestKey('GET', `/zones/${this.zoneId}/rulesets`)
    return this.optimizer.deduplicateRequest(dedupKey, async () => {
      try {
        const response = await this.get<CloudflareAPIResponse<CloudflareRuleset[]>>(`/zones/${this.zoneId}/rulesets`)

        if (!response.success) {
          throw CloudflareErrorHandler.handleApiResponse(response, `/zones/${this.zoneId}/rulesets`)
        }

        // Validate response structure to prevent malformed data issues
        if (!Array.isArray(response.result)) {
          logger.warn('Malformed API response: expected array of rulesets, got:', typeof response.result)
          return []
        }

        // Filter out any malformed ruleset objects
        const validRulesets = response.result.filter((ruleset) => {
          if (!ruleset || typeof ruleset !== 'object') {
            logger.warn('Skipping malformed ruleset object:', ruleset)
            return false
          }
          if (!ruleset.id || !ruleset.name) {
            logger.warn('Skipping ruleset with missing required fields:', { id: ruleset.id, name: ruleset.name })
            return false
          }
          return true
        })

        if (validRulesets.length !== response.result.length) {
          logger.warn(`Filtered out ${response.result.length - validRulesets.length} malformed rulesets`)
        }

        this.cache.set(cacheKey, validRulesets, CacheTTL.RULESETS)
        return validRulesets
      } catch (error) {
        if (error instanceof Error && !(error as any).code) {
          throw CloudflareErrorHandler.handleNetworkError(error, 'listing rulesets')
        }
        throw error
      }
    })
  }

  /**
   * Get all rulesets for the zone (alias for listRulesets)
   */
  public async getRulesets(): Promise<CloudflareRuleset[]> {
    return this.listRulesets()
  }

  /**
   * Get a specific ruleset by ID
   */
  public async getRuleset(rulesetId: string): Promise<CloudflareRuleset> {
    logger.debug(`Fetching ruleset ${rulesetId}`)

    // Check cache first
    const cacheKey = CacheKeys.ruleset(this.zoneId, rulesetId)
    const cached = this.cache.get<CloudflareRuleset>(cacheKey)
    if (cached) {
      return cached
    }

    // Deduplicate concurrent requests for the same ruleset
    const dedupKey = CloudflareOptimizer.requestKey('GET', `/zones/${this.zoneId}/rulesets/${rulesetId}`)
    return this.optimizer.deduplicateRequest(dedupKey, async () => {
      try {
        const response = await this.get<CloudflareAPIResponse<CloudflareRuleset>>(
          `/zones/${this.zoneId}/rulesets/${rulesetId}`,
        )

        if (!response.success) {
          throw CloudflareErrorHandler.handleApiResponse(response, `/zones/${this.zoneId}/rulesets/${rulesetId}`)
        }

        // Validate response structure
        if (!response.result || typeof response.result !== 'object') {
          throw CloudflareErrorHandler.handleValidationError(
            'ruleset',
            'Invalid ruleset data received from API',
            response.result,
          )
        }

        const ruleset = response.result
        if (!ruleset.id || !ruleset.name) {
          throw CloudflareErrorHandler.handleValidationError(
            'ruleset',
            'Ruleset missing required fields (id, name)',
            ruleset,
          )
        }

        // Ensure rules array exists and is valid
        if (!Array.isArray(ruleset.rules)) {
          logger.warn(`Ruleset ${rulesetId} has invalid rules array, initializing as empty`)
          ruleset.rules = []
        }

        // Filter out malformed rules
        const validRules = ruleset.rules.filter((rule) => {
          if (!rule || typeof rule !== 'object') {
            logger.warn(`Skipping malformed rule in ruleset ${rulesetId}:`, rule)
            return false
          }
          if (!rule.id || !rule.expression || !rule.action) {
            logger.warn(`Skipping rule with missing required fields in ruleset ${rulesetId}:`, {
              id: rule.id,
              expression: rule.expression,
              action: rule.action,
            })
            return false
          }
          return true
        })

        if (validRules.length !== ruleset.rules.length) {
          logger.warn(
            `Filtered out ${ruleset.rules.length - validRules.length} malformed rules from ruleset ${rulesetId}`,
          )
          ruleset.rules = validRules
        }

        this.cache.set(cacheKey, ruleset, CacheTTL.RULESET)
        return ruleset
      } catch (error) {
        if (error instanceof Error && !(error as any).code) {
          throw CloudflareErrorHandler.handleNetworkError(error, 'fetching ruleset')
        }
        throw error
      }
    })
  }

  /**
   * Create a new ruleset
   */
  public async createRuleset(ruleset: CloudflareCreateRulesetRequest): Promise<CloudflareRuleset> {
    logger.debug(`Creating ruleset: ${ruleset.name}`)

    const response = await this.post<CloudflareAPIResponse<CloudflareRuleset>>(
      `/zones/${this.zoneId}/rulesets`,
      ruleset,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Created ruleset: ${response.result.name} (${response.result.id})`)
    this.invalidateRulesetCache()
    return response.result
  }

  /**
   * Update an entire ruleset (creates new version)
   */
  public async updateRuleset(rulesetId: string, ruleset: CloudflareUpdateRulesetRequest): Promise<CloudflareRuleset> {
    logger.debug(`Updating ruleset ${rulesetId}`)

    const response = await this.put<CloudflareAPIResponse<CloudflareRuleset>>(
      `/zones/${this.zoneId}/rulesets/${rulesetId}`,
      ruleset,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets/${rulesetId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Updated ruleset to version ${response.result.version}`)
    this.invalidateRulesetCache()
    return response.result
  }

  /**
   * Delete a ruleset
   */
  public async deleteRuleset(rulesetId: string): Promise<void> {
    logger.debug(`Deleting ruleset ${rulesetId}`)

    const response = await this.delete<CloudflareAPIResponse<void>>(`/zones/${this.zoneId}/rulesets/${rulesetId}`)

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets/${rulesetId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Deleted ruleset ${rulesetId}`)
    this.invalidateRulesetCache()
  }

  /**
   * Add a rule to a ruleset
   */
  public async createRule(rulesetId: string, rule: CloudflareCreateRuleRequest): Promise<CloudflareRuleset> {
    logger.debug(`Adding rule to ruleset ${rulesetId}`)

    const response = await this.post<CloudflareAPIResponse<CloudflareRuleset>>(
      `/zones/${this.zoneId}/rulesets/${rulesetId}/rules`,
      rule,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets/${rulesetId}/rules`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Added rule to ruleset ${rulesetId}`)
    this.invalidateRulesetCache()
    return response.result
  }

  /**
   * Update a specific rule in a ruleset
   */
  public async updateRule(
    rulesetId: string,
    ruleId: string,
    rule: CloudflareUpdateRuleRequest,
  ): Promise<CloudflareRuleset> {
    logger.debug(`Updating rule ${ruleId} in ruleset ${rulesetId}`)

    const response = await this.patch<CloudflareAPIResponse<CloudflareRuleset>>(
      `/zones/${this.zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
      rule,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Updated rule ${ruleId}`)
    this.invalidateRulesetCache()
    return response.result
  }

  /**
   * Delete a rule from a ruleset
   */
  public async deleteRule(rulesetId: string, ruleId: string): Promise<CloudflareRuleset> {
    logger.debug(`Deleting rule ${ruleId} from ruleset ${rulesetId}`)

    const response = await this.delete<CloudflareAPIResponse<CloudflareRuleset>>(
      `/zones/${this.zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/zones/${this.zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Deleted rule ${ruleId}`)
    this.invalidateRulesetCache()
    return response.result
  }

  /**
   * Get or create a custom firewall ruleset
   * Finds existing custom firewall ruleset or creates a new one
   */
  public async getOrCreateFirewallRuleset(): Promise<CloudflareRuleset> {
    logger.debug('Looking for existing custom firewall ruleset')

    const rulesets = await this.listRulesets()
    const existingRuleset = rulesets.find((rs) => rs.kind === 'custom' && rs.phase === 'http_request_firewall_custom')

    if (existingRuleset) {
      logger.debug(`Found existing ruleset: ${existingRuleset.id}`)
      return existingRuleset
    }

    // Create new ruleset
    logger.info('No existing custom firewall ruleset found, creating new one')
    return this.createRuleset({
      name: 'Doorman Custom Firewall Rules',
      kind: 'custom',
      phase: 'http_request_firewall_custom',
      description: 'Custom firewall rules managed by Doorman',
      rules: [],
    })
  }

  /**
   * Verify API credentials and connectivity
   */
  public async verifyCredentials(): Promise<boolean> {
    // Check cache for recent successful validation
    // A real hash, not a raw token substring — cache.ts logs this key verbatim
    // under --debug (`Cache set: cred:<hash> ...`), and a substring of the
    // actual token would leak a fragment of the secret into those logs.
    const tokenHash = createHash('sha256').update(this.apiToken).digest('hex').slice(0, 8)
    const cacheKey = CacheKeys.credentialValidation(tokenHash)
    const cached = this.cache.get<boolean>(cacheKey)
    if (cached !== undefined) {
      logger.debug('Using cached credential validation result')
      return cached
    }

    try {
      logger.debug('Verifying Cloudflare credentials')

      // Try to list rulesets - if this succeeds, credentials are valid
      await this.listRulesets()

      logger.info('Cloudflare credentials verified successfully')
      this.cache.set(cacheKey, true, CacheTTL.CREDENTIALS)
      return true
    } catch (error) {
      logger.error(`Cloudflare credential verification failed: ${error}`)

      // Provide more specific error information for credential issues
      if (error instanceof Error) {
        const message = error.message.toLowerCase()
        if (message.includes('unauthorized') || message.includes('invalid token')) {
          throw CloudflareErrorHandler.handleCredentialError('token')
        }
        if (message.includes('forbidden') || message.includes('access denied')) {
          throw CloudflareErrorHandler.handleCredentialError('zone', this.zoneId)
        }
        if (message.includes('not found')) {
          throw CloudflareErrorHandler.handleCredentialError('zone', this.zoneId)
        }
      }

      return false
    }
  }

  /**
   * Get zone information
   */
  public async getZoneInfo(): Promise<{ id: string; name: string; status: string; plan?: { name: string } }> {
    // Check cache first – zone info rarely changes
    const cacheKey = CacheKeys.zoneInfo(this.zoneId)
    const cached = this.cache.get<{ id: string; name: string; status: string; plan?: { name: string } }>(cacheKey)
    if (cached) {
      return cached
    }

    const response = await this.get<
      CloudflareAPIResponse<{
        id: string
        name: string
        status: string
        plan?: { name: string }
      }>
    >(`/zones/${this.zoneId}`)

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError('cloudflare', `/zones/${this.zoneId}`, response.errors[0]?.code || 0, errorMessage)
    }

    this.cache.set(cacheKey, response.result, CacheTTL.ZONE_INFO)
    return response.result
  }

  /**
   * Cloudflare Lists API
   * Lists are used for bulk IP management
   */

  /**
   * List all Lists (account-level)
   */
  public async listLists(): Promise<CloudflareList[]> {
    logger.debug('Fetching Cloudflare Lists')

    if (!this.accountId) {
      logger.warn('Account ID not provided, Lists API requires account-level access')
      return []
    }

    // Check cache first
    const cacheKey = CacheKeys.lists(this.accountId)
    const cached = this.cache.get<CloudflareList[]>(cacheKey)
    if (cached) {
      return cached
    }

    const response = await this.get<CloudflareAPIResponse<CloudflareList[]>>(`/accounts/${this.accountId}/rules/lists`)

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    this.cache.set(cacheKey, response.result, CacheTTL.LISTS)
    return response.result
  }

  /**
   * Get a specific List by ID
   */
  public async getList(listId: string): Promise<CloudflareList> {
    logger.debug(`Fetching List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.get<CloudflareAPIResponse<CloudflareList>>(
      `/accounts/${this.accountId}/rules/lists/${listId}`,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists/${listId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    return response.result
  }

  /**
   * Create a new List
   */
  public async createList(list: CloudflareCreateListRequest): Promise<CloudflareList> {
    logger.debug(`Creating List: ${list.name}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.post<CloudflareAPIResponse<CloudflareList>>(
      `/accounts/${this.accountId}/rules/lists`,
      list,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Created List: ${response.result.name} (${response.result.id})`)
    this.invalidateListCache()
    return response.result
  }

  /**
   * Update a List
   */
  public async updateList(listId: string, list: CloudflareUpdateListRequest): Promise<CloudflareList> {
    logger.debug(`Updating List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.put<CloudflareAPIResponse<CloudflareList>>(
      `/accounts/${this.accountId}/rules/lists/${listId}`,
      list,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists/${listId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Updated List ${listId}`)
    this.invalidateListCache()
    return response.result
  }

  /**
   * Delete a List
   */
  public async deleteList(listId: string): Promise<void> {
    logger.debug(`Deleting List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.delete<CloudflareAPIResponse<void>>(`/accounts/${this.accountId}/rules/lists/${listId}`)

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists/${listId}`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Deleted List ${listId}`)
    this.invalidateListCache()
  }

  /**
   * Get all items in a List
   */
  public async getListItems(listId: string): Promise<CloudflareListItem[]> {
    logger.debug(`Fetching items from List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    // Check cache first
    const cacheKey = CacheKeys.listItems(this.accountId, listId)
    const cached = this.cache.get<CloudflareListItem[]>(cacheKey)
    if (cached) {
      return cached
    }

    // Deduplicate concurrent requests for the same list items
    const dedupKey = CloudflareOptimizer.requestKey('GET', `/accounts/${this.accountId}/rules/lists/${listId}/items`)
    return this.optimizer.deduplicateRequest(dedupKey, async () => {
      const response = await this.get<CloudflareListItemsResponse>(
        `/accounts/${this.accountId}/rules/lists/${listId}/items`,
      )

      if (!response.success) {
        const errorMessage = response.errors.map((e) => e.message).join(', ')
        throw providerErrors.apiError(
          'cloudflare',
          `/accounts/${this.accountId}/rules/lists/${listId}/items`,
          response.errors[0]?.code || 0,
          errorMessage,
        )
      }

      this.cache.set(cacheKey, response.result, CacheTTL.LIST_ITEMS)
      return response.result
    })
  }

  /**
   * Add items to a List
   */
  public async addListItems(listId: string, request: CloudflareAddListItemsRequest): Promise<CloudflareListItem[]> {
    logger.debug(`Adding ${request.items.length} items to List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.post<CloudflareListItemsResponse>(
      `/accounts/${this.accountId}/rules/lists/${listId}/items`,
      request.items,
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists/${listId}/items`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Added ${request.items.length} items to List ${listId}`)
    this.invalidateListCache()
    return response.result
  }

  /**
   * Remove items from a List
   */
  public async removeListItems(listId: string, request: CloudflareRemoveListItemsRequest): Promise<void> {
    logger.debug(`Removing ${request.items.length} items from List ${listId}`)

    if (!this.accountId) {
      throw cloudflareErrors.accountIdRequired('Lists API')
    }

    const response = await this.delete<CloudflareAPIResponse<void>>(
      `/accounts/${this.accountId}/rules/lists/${listId}/items`,
      {
        body: JSON.stringify(request),
      },
    )

    if (!response.success) {
      const errorMessage = response.errors.map((e) => e.message).join(', ')
      throw providerErrors.apiError(
        'cloudflare',
        `/accounts/${this.accountId}/rules/lists/${listId}/items`,
        response.errors[0]?.code || 0,
        errorMessage,
      )
    }

    logger.info(`Removed ${request.items.length} items from List ${listId}`)
    this.invalidateListCache()
  }

  /**
   * Get or create a List for IP blocking
   * Finds existing "Doorman IP Blocklist" or creates one
   */
  public async getOrCreateIPBlocklist(): Promise<CloudflareList> {
    logger.debug('Looking for existing Doorman IP blocklist')

    if (!this.accountId) {
      logger.warn('Account ID not provided, cannot use Lists for IP blocking')
      throw CloudflareErrorHandler.handleCredentialError('account')
    }

    try {
      const lists = await this.listLists()
      const existingList = lists.find((list) => list.name === 'Doorman IP Blocklist' && list.kind === 'ip')

      if (existingList) {
        logger.debug(`Found existing IP blocklist: ${existingList.id}`)
        return existingList
      }

      // Create new list
      logger.info('No existing IP blocklist found, creating new one')
      return this.createList({
        name: 'Doorman IP Blocklist',
        description: 'IP addresses blocked by Doorman',
        kind: 'ip',
      })
    } catch (error) {
      if (error instanceof Error && !(error as any).code) {
        throw CloudflareErrorHandler.handleNetworkError(error, 'managing IP blocklist')
      }
      throw error
    }
  }
}
