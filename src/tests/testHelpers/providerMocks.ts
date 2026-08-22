import type { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { CloudflareOptimizer } from '../../lib/providers/cloudflare/CloudflareOptimizer'
import type { CloudflareRuleset } from '../../lib/types/cloudflare'
import type { VercelClient, VercelConfig } from '../../lib/providers/vercel/VercelClient'
import type { FastlyClient } from '../../lib/providers/fastly/FastlyClient'
import type { FastlyRule, FastlyRuleInput, FastlyList } from '../../lib/types/fastly'
import type { CloudArmorClient } from '../../lib/providers/gcp/CloudArmorClient'
import type { CloudArmorRule, CloudArmorSecurityPolicy } from '../../lib/types/gcp'

/**
 * Default empty Cloudflare ruleset used by tests that don't care about its contents.
 */
export function emptyCloudflareRuleset(overrides: Partial<CloudflareRuleset> = {}): CloudflareRuleset {
  return {
    id: 'ruleset-1',
    name: 'Doorman Custom Ruleset',
    description: 'Managed by Doorman',
    kind: 'custom',
    phase: 'http_request_firewall_custom',
    version: '1',
    last_updated: '2024-01-01T00:00:00Z',
    rules: [],
    ...overrides,
  }
}

/**
 * Wires up a mocked `CloudflareClient` class (from `jest.mock('.../CloudflareClient')`)
 * with sensible defaults so commands that resolve a Cloudflare provider (via
 * `withCredentials` -> `getProviderInstance` -> `CloudflareProvider.fromConfig`) don't
 * make real network calls. Call this after `jest.mock('.../CloudflareClient')` in the
 * test file; pass the mocked class itself.
 */
export function mockCloudflareClientPrototype(
  MockedCloudflareClient: jest.MockedClass<typeof CloudflareClient>,
  options: { ruleset?: CloudflareRuleset } = {},
): void {
  const ruleset = options.ruleset ?? emptyCloudflareRuleset()

  // Real (not mocked) — it's pure diffing logic, not a network call, and
  // CloudflareFirewallService.getChanges depends on it actually working.
  MockedCloudflareClient.prototype.getOptimizer = jest.fn().mockReturnValue(new CloudflareOptimizer()) as any
  MockedCloudflareClient.prototype.getOrCreateFirewallRuleset = jest.fn().mockResolvedValue(ruleset) as any
  MockedCloudflareClient.prototype.updateRuleset = jest.fn().mockResolvedValue({ ...ruleset, version: '2' }) as any
  MockedCloudflareClient.prototype.getOrCreateIPBlocklist = jest.fn().mockResolvedValue({
    id: 'list-1',
    name: 'Doorman IP Blocklist',
    description: 'Managed by Doorman',
    kind: 'ip',
    num_items: 0,
    num_referencing_filters: 0,
    created_on: '2024-01-01T00:00:00Z',
    modified_on: '2024-01-01T00:00:00Z',
  }) as any
  MockedCloudflareClient.prototype.getListItems = jest.fn().mockResolvedValue([]) as any
  MockedCloudflareClient.prototype.addListItems = jest.fn().mockResolvedValue([]) as any
  MockedCloudflareClient.prototype.removeListItems = jest.fn().mockResolvedValue(undefined) as any
  MockedCloudflareClient.prototype.verifyCredentials = jest.fn().mockResolvedValue(true) as any
}

/**
 * Default empty Vercel firewall config used by tests that don't care about its contents.
 */
export function emptyVercelConfig(overrides: Partial<VercelConfig> = {}): VercelConfig {
  return {
    version: 1,
    id: 'config_1',
    firewallEnabled: true,
    crs: null,
    rules: [],
    ips: [],
    projectKey: 'pk_1',
    ownerId: 'owner_1',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Wires up a mocked `VercelClient` class (from `jest.mock('.../providers/vercel/VercelClient')`)
 * with sensible defaults so commands that resolve a Vercel provider (via
 * `withCredentials` -> `getProviderInstance` -> `VercelProvider.fromConfig`) don't
 * make real network calls. Call this after `jest.mock('.../providers/vercel/VercelClient')`
 * in the test file; pass the mocked class itself.
 */
export function mockVercelClientPrototype(
  MockedVercelClient: jest.MockedClass<typeof VercelClient>,
  options: { config?: VercelConfig } = {},
): void {
  const config = options.config ?? emptyVercelConfig()

  // A plain `jest.mock(...)` automock does NOT run the real constructor, so
  // `this.projectId`/`this.teamId` (set via constructor params) are
  // otherwise `undefined` on every mocked instance — which
  // VercelFirewallService reads via `this.client['projectId']` (e.g. to
  // populate `providers.vercel.projectId` on a fetched config). Restoring
  // that via mockImplementation keeps prototype method mocks intact.
  MockedVercelClient.mockImplementation(function (
    this: VercelClient,
    projectId: string,
    teamId: string | undefined,
    token: string,
  ) {
    Object.assign(this, { projectId, teamId, token })
  } as unknown as (projectId: string, teamId: string | undefined, token: string) => VercelClient)

  MockedVercelClient.prototype.fetchFirewallConfig = jest.fn().mockResolvedValue(config) as any
  MockedVercelClient.prototype.createFirewallRule = jest
    .fn()
    .mockImplementation((rule) =>
      Promise.resolve({ ...rule, id: `rule_${Math.random().toString(36).slice(2)}` }),
    ) as any
  MockedVercelClient.prototype.updateFirewallRule = jest.fn().mockImplementation((rule) => Promise.resolve(rule)) as any
  MockedVercelClient.prototype.deleteFirewallRule = jest.fn().mockResolvedValue(undefined) as any
  MockedVercelClient.prototype.createIPBlockingRule = jest
    .fn()
    .mockImplementation((rule) => Promise.resolve({ ...rule, id: `ip_${Math.random().toString(36).slice(2)}` })) as any
  MockedVercelClient.prototype.updateIPBlockingRule = jest
    .fn()
    .mockImplementation((rule) => Promise.resolve(rule)) as any
  MockedVercelClient.prototype.deleteIPBlockingRule = jest.fn().mockResolvedValue(undefined) as any
  MockedVercelClient.prototype.verifyCredentials = jest.fn().mockResolvedValue(true) as any
}

/**
 * Default empty Fastly list used by tests that don't care about its contents.
 */
export function emptyFastlyList(overrides: Partial<FastlyList> = {}): FastlyList {
  return {
    id: 'list-1',
    name: 'doorman-managed-deny',
    description: 'Managed by doorman',
    type: 'ip',
    entries: [],
    reference_id: '',
    scope: { type: 'workspace' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

let fastlyRuleIdCounter = 0

/** Builds a plausible API response `FastlyRule` from a `FastlyRuleInput`, merging its three condition arrays into the response's single polymorphic `conditions[]` — mirrors what Fastly's real API actually returns. */
function fastlyRuleFromInput(id: string, input: FastlyRuleInput): FastlyRule {
  return {
    id,
    type: input.type,
    scope: { type: 'workspace', applies_to: ['workspace-1'] },
    enabled: input.enabled,
    description: input.description,
    group_operator: input.group_operator,
    request_logging: input.request_logging ?? 'sampled',
    conditions: [...(input.conditions ?? []), ...(input.group_conditions ?? []), ...(input.multival_conditions ?? [])],
    actions: input.actions,
    rate_limit: input.rate_limit ?? null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }
}

/**
 * Wires up a mocked `FastlyClient` class (from `jest.mock('.../providers/fastly/FastlyClient')`)
 * with sensible defaults so commands that resolve a Fastly provider don't make real network
 * calls. Call this after `jest.mock('.../providers/fastly/FastlyClient')` in the test file; pass
 * the mocked class itself.
 */
export function mockFastlyClientPrototype(
  MockedFastlyClient: jest.MockedClass<typeof FastlyClient>,
  options: { rules?: FastlyRule[]; lists?: FastlyList[] } = {},
): void {
  const rules = options.rules ?? []
  const lists = options.lists ?? []

  // See the equivalent note on `mockVercelClientPrototype` — an automock
  // doesn't run the real constructor, so `this.workspaceId` (read via
  // `this.client['workspaceId']`) would otherwise be undefined.
  MockedFastlyClient.mockImplementation(function (this: FastlyClient, workspaceId: string, apiToken: string) {
    Object.assign(this, { workspaceId, apiToken })
  } as unknown as (workspaceId: string, apiToken: string) => FastlyClient)

  MockedFastlyClient.prototype.fetchRules = jest.fn().mockResolvedValue(rules) as any
  MockedFastlyClient.prototype.createRule = jest.fn().mockImplementation((input: FastlyRuleInput) => {
    fastlyRuleIdCounter += 1
    return Promise.resolve(fastlyRuleFromInput(`rule_${fastlyRuleIdCounter}`, input))
  }) as any
  MockedFastlyClient.prototype.updateRule = jest
    .fn()
    .mockImplementation((id: string, input: FastlyRuleInput) => Promise.resolve(fastlyRuleFromInput(id, input))) as any
  MockedFastlyClient.prototype.deleteRule = jest.fn().mockResolvedValue(undefined) as any
  MockedFastlyClient.prototype.fetchLists = jest.fn().mockResolvedValue(lists) as any
  MockedFastlyClient.prototype.findList = jest
    .fn()
    .mockImplementation((name: string) => Promise.resolve(lists.find((l) => l.name === name) ?? null)) as any
  MockedFastlyClient.prototype.createList = jest
    .fn()
    .mockImplementation((name: string, entries: string[]) => Promise.resolve(emptyFastlyList({ name, entries }))) as any
  MockedFastlyClient.prototype.getOrCreateList = jest
    .fn()
    .mockImplementation((name: string) =>
      Promise.resolve(lists.find((l) => l.name === name) ?? emptyFastlyList({ name })),
    ) as any
  MockedFastlyClient.prototype.updateListEntries = jest
    .fn()
    .mockImplementation((id: string, entries: string[]) => Promise.resolve(emptyFastlyList({ id, entries }))) as any
  MockedFastlyClient.prototype.verifyCredentials = jest.fn().mockResolvedValue(true) as any
}

/**
 * Default empty Cloud Armor security policy used by tests that don't care about its contents.
 */
export function emptyCloudArmorPolicy(overrides: Partial<CloudArmorSecurityPolicy> = {}): CloudArmorSecurityPolicy {
  return {
    id: 'policy-1',
    name: 'doorman-managed-policy',
    description: 'Managed by doorman',
    rules: [],
    fingerprint: 'fp-1',
    ...overrides,
  }
}

/**
 * Wires up a mocked `CloudArmorClient` class (from `jest.mock('.../providers/gcp/CloudArmorClient')`)
 * with sensible defaults so commands that resolve a GCP provider don't make
 * real network calls. Unlike the other providers' mocks, this keeps a real
 * in-memory `rules[]` array that `addRule`/`patchRule`/`removeRule` actually
 * mutate and `getPolicy` reflects — `CloudArmorFirewallService.syncRules`
 * re-fetches the policy mid-sync (to compute unoccupied priorities), so a
 * mock that always returns the same static snapshot would silently hide
 * priority-collision bugs a stateful one catches. Call this after
 * `jest.mock('.../providers/gcp/CloudArmorClient')` in the test file; pass
 * the mocked class itself.
 */
export function mockCloudArmorClientPrototype(
  MockedCloudArmorClient: jest.MockedClass<typeof CloudArmorClient>,
  options: { rules?: CloudArmorRule[] } = {},
): void {
  const state: { rules: CloudArmorRule[] } = { rules: [...(options.rules ?? [])] }

  // See the equivalent note on `mockVercelClientPrototype`/`mockFastlyClientPrototype`
  // — an automock doesn't run the real constructor, so `this.projectId`
  // (read via the real, public `client.projectId`) would otherwise be undefined.
  MockedCloudArmorClient.mockImplementation(function (this: CloudArmorClient, projectId: string, policyName: string) {
    Object.assign(this, { projectId, policyName })
  } as unknown as (projectId: string, policyName: string) => CloudArmorClient)

  MockedCloudArmorClient.prototype.getPolicy = jest
    .fn()
    .mockImplementation(() => Promise.resolve(emptyCloudArmorPolicy({ rules: state.rules }))) as any
  MockedCloudArmorClient.prototype.addRule = jest.fn().mockImplementation((rule: CloudArmorRule) => {
    if (state.rules.some((r) => r.priority === rule.priority)) {
      return Promise.reject(new Error(`gcp API error: 400 Bad Request - priority ${rule.priority} already in use`))
    }
    state.rules.push(rule)
    return Promise.resolve(undefined)
  }) as any
  MockedCloudArmorClient.prototype.patchRule = jest
    .fn()
    .mockImplementation((priority: number, rule: CloudArmorRule) => {
      const index = state.rules.findIndex((r) => r.priority === priority)
      if (index === -1) {
        return Promise.reject(new Error(`gcp API error: 404 Not Found - no rule at priority ${priority}`))
      }
      state.rules[index] = rule
      return Promise.resolve(undefined)
    }) as any
  MockedCloudArmorClient.prototype.removeRule = jest.fn().mockImplementation((priority: number) => {
    state.rules = state.rules.filter((r) => r.priority !== priority)
    return Promise.resolve(undefined)
  }) as any
  MockedCloudArmorClient.prototype.verifyCredentials = jest.fn().mockResolvedValue(true) as any
}
