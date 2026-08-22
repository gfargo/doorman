import { firewallConfigSchema } from '../firewallSchemas'
import { unifiedConfigSchema } from '../unifiedSchemas'
import { toUnifiedConfig } from '../../utils/vercelConfigAdapter'
import type { FirewallConfig } from '../../types'

/**
 * #212, #213, and #219 were three independent instances of the same
 * underlying problem: `doorman validate` checks a config against the native
 * (Vercel-shaped) schemas, while `status`/`diff`/`backup`/`sync` translate
 * the same on-disk config to `UnifiedConfig` first and check *that* against
 * a separate set of schemas — and the two sets disagreed on what counts as
 * valid. A config could pass one and fail the other, on a rule that was
 * already live in production.
 *
 * Rather than only unit-testing each fixed field in isolation (see
 * firewallSchemas.test.ts / unifiedSchemas.test.ts / commonSchemas.test.ts),
 * this file exercises the actual translation pipeline (`toUnifiedConfig`,
 * the same function `status`/`diff`/`backup` call) against one config
 * combining all three real-world cases from the issues, and asserts both
 * validation paths accept it. This is the "shared regression test" #213 and
 * #219 both suggested — a fix to one field, verified only in isolation,
 * wouldn't have caught a fourth field drifting the same way in the future
 * the way this end-to-end check would.
 */
describe('native vs unified schema agreement (regression tests for #212/#213/#219)', () => {
  // Modeled directly on the real griffen.codes rules each issue quoted.
  const nativeConfig: FirewallConfig = {
    projectId: 'prj_test',
    teamId: 'team_test',
    version: 5,
    rules: [
      {
        id: 'rule_allow_supabase_cookies',
        name: 'Allow Supabase Cookies',
        // #213: `nex` (exists/not_exists) conditions carry no `value`.
        conditionGroup: [{ conditions: [{ type: 'cookie', op: 'nex', key: 'supabase_auth' }] }],
        action: { mitigate: { action: 'bypass' } },
        active: true,
      },
      {
        id: 'rule_emergency_redirect',
        name: 'Emergency redirect',
        conditionGroup: [{ conditions: [{ type: 'path', op: 'eq', value: '/old-page' }] }],
        // #212: a relative-path redirect location, not an absolute URL.
        action: { mitigate: { action: 'redirect', redirect: { location: '/correct-path' } } },
        active: true,
      },
    ],
    // #219: no `hostname` on the IP rule.
    ips: [{ id: 'ip_blocked', ip: '192.168.1.100/32', action: 'deny', notes: 'Known bad actor' }],
  }

  it("passes doorman validate's native schema (firewallConfigSchema)", () => {
    const result = firewallConfigSchema.safeParse(nativeConfig)
    expect(result.success).toBe(true)
  })

  it("also passes status/diff/backup/sync's schema (unifiedConfigSchema), once translated by the same toUnifiedConfig() they call", () => {
    const unified = toUnifiedConfig(nativeConfig)
    const result = unifiedConfigSchema.safeParse(unified)

    if (!result.success) {
      // Fail with the actual Zod issues, not just true/false — this is the
      // one test in the suite most likely to need real debugging if a
      // future field reintroduces this class of drift.
      throw new Error(
        `unifiedConfigSchema rejected the translated config:\n${JSON.stringify(result.error.issues, null, 2)}`,
      )
    }
    expect(result.success).toBe(true)
  })
})
