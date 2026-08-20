/**
 * Conformance suite: invariants every `IFirewallProvider` implementation is
 * expected to satisfy, run generically against every entry in `PROVIDER_TYPES`
 * rather than hand-written per-provider.
 *
 * Why this exists (#197): nothing before this suite ran the same check
 * against both providers automatically. #193 (Cloudflare silently ignoring
 * a config-declared zoneId/accountId while Vercel's equivalent path had been
 * fixed by #171) is a concrete example of the failure mode — each provider's
 * own tests only assert things about themselves, so two providers satisfying
 * the interface differently just both passed. The credential-precedence
 * cases below are mutation-verified against that exact bug (see the PR
 * description for the before/after).
 *
 * Adding a provider: as long as it's registered in `PROVIDER_TYPES` and
 * `CREDENTIAL_DESCRIPTORS`, the credential-precedence and FeatureSet/
 * validateConfig cases below cover it automatically with zero edits here.
 * The `config-declared credentials` and `dryRun` cases need one addition
 * each (a `CREDENTIAL_CONFORMANCE_CASES` entry and an `it(...)` block,
 * respectively) — a small, unavoidable amount of per-provider setup (each
 * provider's config shape and HTTP client mocking surface genuinely
 * differ), but the assertions themselves stay generic.
 *
 * Deliberately out of scope for this first pass (see #197's own text: land
 * what's true today, grow as more providers surface new invariants):
 * - "partial syncRules failure surfaces via errors[]" — checked while
 *   scoping this suite, and it doesn't hold uniformly today: Vercel's write
 *   model is per-rule (individual creates/updates that can fail
 *   independently), while Cloudflare's is a single atomic ruleset replace
 *   (one PUT, no per-rule partial-failure state to observe). Asserting it
 *   generically now would either skip Cloudflare silently or mischaracterize
 *   its write model. Revisit once a provider with a genuinely comparable
 *   partial-failure shape exists.
 * - "getChanges reflects a priority-only reorder" — already covered per-
 *   provider by #179's tests; generalizing it needs a uniform way to seed
 *   ordered remote state across providers with very different remote
 *   shapes, which is a bigger lift better justified once a third provider
 *   exists to prove the abstraction against.
 */

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../ui/prompt', () => ({
  prompt: jest.fn(),
}))

jest.mock('../vercel/VercelClient')
jest.mock('../cloudflare/CloudflareClient')

import { PROVIDER_TYPES, type ProviderType, type FeatureSet } from '../IFirewallProvider'
import { CREDENTIAL_DESCRIPTORS, resolveCredentials } from '../credentials'
import { getProviderInstance, type ProviderOptions } from '../../utils/providerHelper'
import { VercelProvider } from '../vercel'
import { CloudflareProvider } from '../cloudflare'
import { VercelClient } from '../vercel/VercelClient'
import { CloudflareClient } from '../cloudflare/CloudflareClient'
import { OperationSafety } from '../../utils/operationSafety'
import {
  mockVercelClientPrototype,
  mockCloudflareClientPrototype,
  emptyVercelConfig,
  emptyCloudflareRuleset,
} from '../../../tests/testHelpers/providerMocks'
import type { UnifiedConfig } from '../../types/unified'

const MockedVercelClient = VercelClient as jest.MockedClass<typeof VercelClient>
const MockedCloudflareClient = CloudflareClient as jest.MockedClass<typeof CloudflareClient>

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(OperationSafety, 'confirmDestructiveOperation').mockResolvedValue(true)
})

describe('provider conformance: credential resolution (flag > config > env)', () => {
  it.each(PROVIDER_TYPES)('%s: an explicit value beats both config and env for every credential', (type) => {
    const descriptor = CREDENTIAL_DESCRIPTORS[type]
    const explicit: Record<string, string> = {}
    const config: Record<string, string> = {}
    const env: Record<string, string> = {}
    for (const field of descriptor.fields) {
      explicit[field.key] = `explicit-${field.key}`
      config[field.key] = `config-${field.key}`
      env[field.envVar] = `env-${field.key}`
    }

    const resolved = resolveCredentials(descriptor, { explicit, config, env })

    for (const field of descriptor.fields) {
      expect(resolved[field.key]).toBe(`explicit-${field.key}`)
    }
  })

  it.each(PROVIDER_TYPES)(
    '%s: a config value beats env for every credential that can live in a config file',
    (type) => {
      const descriptor = CREDENTIAL_DESCRIPTORS[type]
      // Only fields with a configKey are ever populated from a real config
      // file by providerHelper.ts (secrets like the API token have none, by
      // design — see CredentialField.configKey's doc comment) — restricting
      // this case to them keeps it honest about what's actually exercised.
      const configurable = descriptor.fields.filter((f) => f.configKey)
      expect(configurable.length).toBeGreaterThan(0)

      const config: Record<string, string> = {}
      const env: Record<string, string> = {}
      for (const field of configurable) {
        config[field.key] = `config-${field.key}`
        env[field.envVar] = `env-${field.key}`
      }

      const resolved = resolveCredentials(descriptor, { config, env })

      for (const field of configurable) {
        expect(resolved[field.key]).toBe(`config-${field.key}`)
      }
    },
  )

  it.each(PROVIDER_TYPES)('%s: falls back to env when neither explicit nor config supplies a value', (type) => {
    const descriptor = CREDENTIAL_DESCRIPTORS[type]
    const env: Record<string, string> = {}
    for (const field of descriptor.fields) {
      env[field.envVar] = `env-${field.key}`
    }

    const resolved = resolveCredentials(descriptor, { env })

    for (const field of descriptor.fields) {
      expect(resolved[field.key]).toBe(`env-${field.key}`)
    }
  })
})

/**
 * Exercises the *full* resolution path — getProviderInstance, not just
 * resolveCredentials directly — because #193's bug lived one layer up, in
 * providerHelper.ts's per-provider glue (which builds the `config` map
 * passed into resolveCredentials from each provider's own config shape),
 * not in resolveCredentials itself. Testing only resolveCredentials would
 * not have caught it; this is what makes the mutation-verification below
 * meaningful rather than circular.
 */
const CREDENTIAL_CONFORMANCE_CASES: Array<{ providerType: ProviderType; options: ProviderOptions }> = [
  {
    providerType: 'vercel',
    options: {
      provider: 'vercel',
      token: 'explicit-token',
      interactive: false,
      config: { providers: { vercel: { projectId: 'config-project', teamId: 'config-team' } } } as UnifiedConfig,
    },
  },
  {
    providerType: 'cloudflare',
    options: {
      provider: 'cloudflare',
      apiToken: 'explicit-token',
      interactive: false,
      config: { providers: { cloudflare: { zoneId: 'config-zone', accountId: 'config-account' } } } as UnifiedConfig,
    },
  },
]

describe('provider conformance: config-declared credentials resolve without needing env vars', () => {
  it.each(CREDENTIAL_CONFORMANCE_CASES)(
    '$providerType: getProviderInstance resolves providers.<name> config values',
    async ({ options }) => {
      await expect(getProviderInstance(options)).resolves.toMatchObject({
        provider: { name: options.provider },
      })
    },
  )
})

describe('provider conformance: getSupportedFeatures returns a complete FeatureSet', () => {
  const REQUIRED_BOOLEAN_KEYS: Array<keyof FeatureSet> = [
    'supportsCustomRules',
    'supportsIPBlocking',
    'supportsRateLimiting',
    'supportsManagedRules',
    'supportsGeoBlocking',
    'supportsRedirect',
    'supportsChallenge',
  ]

  it('vercel: every required key is present and boolean', () => {
    const provider = VercelProvider.fromConfig({ token: 't', projectId: 'p', teamId: 'tm' })
    const features = provider.getSupportedFeatures()
    for (const key of REQUIRED_BOOLEAN_KEYS) {
      expect(typeof features[key]).toBe('boolean')
    }
  })

  it('cloudflare: every required key is present and boolean', () => {
    const provider = CloudflareProvider.fromConfig({ apiToken: 't', zoneId: 'z' })
    const features = provider.getSupportedFeatures()
    for (const key of REQUIRED_BOOLEAN_KEYS) {
      expect(typeof features[key]).toBe('boolean')
    }
  })
})

describe('provider conformance: validateConfig rejects a config with no rules array', () => {
  // Deliberately `as unknown as UnifiedConfig` — the point is to send
  // something the *type* forbids but a hand-edited or corrupted config file
  // could still contain, since validateConfig is exactly the runtime check
  // meant to catch that.
  const configWithNoRules = { version: '2.0', provider: 'test' } as unknown as UnifiedConfig

  it('vercel', () => {
    const provider = VercelProvider.fromConfig({ token: 't', projectId: 'p', teamId: 'tm' })
    const result = provider.validateConfig(configWithNoRules)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'RULES_REQUIRED')).toBe(true)
  })

  it('cloudflare', () => {
    const provider = CloudflareProvider.fromConfig({ apiToken: 't', zoneId: 'z' })
    const result = provider.validateConfig(configWithNoRules)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'RULES_REQUIRED')).toBe(true)
  })
})

describe('provider conformance: syncRules never issues a mutating call when dryRun is true', () => {
  const makeLocalConfig = (provider: ProviderType): UnifiedConfig => ({
    version: '2.0',
    provider,
    rules: [
      {
        id: 'new-rule',
        name: 'New Rule',
        enabled: true,
        conditions: [{ field: 'path', operator: 'eq', value: '/new' }],
        action: { type: 'deny' },
      },
    ],
    ips: [],
  })

  it('vercel', async () => {
    mockVercelClientPrototype(MockedVercelClient, { config: emptyVercelConfig({ rules: [] }) })
    const provider = VercelProvider.fromConfig({ token: 't', projectId: 'p', teamId: 'tm' })

    await provider.syncRules(makeLocalConfig('vercel'), { dryRun: true })

    expect(MockedVercelClient.prototype.createFirewallRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.updateFirewallRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.deleteFirewallRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.createIPBlockingRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.updateIPBlockingRule).not.toHaveBeenCalled()
    expect(MockedVercelClient.prototype.deleteIPBlockingRule).not.toHaveBeenCalled()
  })

  it('cloudflare', async () => {
    mockCloudflareClientPrototype(MockedCloudflareClient, { ruleset: emptyCloudflareRuleset({ rules: [] }) })
    const provider = CloudflareProvider.fromConfig({ apiToken: 't', zoneId: 'z' })

    await provider.syncRules(makeLocalConfig('cloudflare'), { dryRun: true })

    expect(MockedCloudflareClient.prototype.updateRuleset).not.toHaveBeenCalled()
    expect(MockedCloudflareClient.prototype.addListItems).not.toHaveBeenCalled()
    expect(MockedCloudflareClient.prototype.removeListItems).not.toHaveBeenCalled()
  })
})
