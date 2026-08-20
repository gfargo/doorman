import type { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { CloudflareOptimizer } from '../../lib/providers/cloudflare/CloudflareOptimizer'
import type { CloudflareRuleset } from '../../lib/types/cloudflare'
import type { VercelClient, VercelConfig } from '../../lib/providers/vercel/VercelClient'

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
 *
 * Note: this mocks the NEW `src/lib/providers/vercel/VercelClient`, which is what
 * `IFirewallProvider`-based command paths use — not the legacy
 * `src/lib/services/VercelClient`.
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
    teamId: string,
    token: string,
  ) {
    Object.assign(this, { projectId, teamId, token })
  } as unknown as (projectId: string, teamId: string, token: string) => VercelClient)

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
