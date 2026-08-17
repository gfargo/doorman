import type { CloudflareClient } from '../../lib/providers/cloudflare/CloudflareClient'
import { CloudflareOptimizer } from '../../lib/providers/cloudflare/CloudflareOptimizer'
import type { CloudflareRuleset } from '../../lib/types/cloudflare'

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
