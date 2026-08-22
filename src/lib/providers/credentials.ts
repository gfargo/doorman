import type { ProviderType } from './IFirewallProvider'
import { vercelCredentials } from './vercel/credentials'
import { cloudflareCredentials } from './cloudflare/credentials'
import { fastlyCredentials } from './fastly/credentials'
import { gcpCredentials } from './gcp/credentials'

/**
 * One credential a provider needs, described rather than hardcoded at each
 * point of use.
 *
 * Before this, a credential's environment-variable name was a bare string
 * literal repeated across `providerHelper`, the provider factory, the
 * detector, and (for Cloudflare) the config validator and setup verifier —
 * so `VERCEL_TOKEN` and friends appeared in six-plus files with nothing
 * tying them together.
 */
export interface CredentialField {
  /**
   * Property name this credential travels under, both on `ProviderOptions`
   * (the CLI flag) and in a resolved credentials bag — e.g. `apiToken`.
   */
  key: string
  /** Environment variable consulted when no flag or config value supplies it. */
  envVar: string
  /** Human-readable name, used in prompts and error messages. */
  label: string
  /** Whether the provider cannot be constructed without it. */
  required: boolean
  /** Whether a value should be masked when prompted for interactively. */
  secret?: boolean
  /**
   * Dotted path within a unified config's `providers.<name>` block, when the
   * credential can be declared in the config file. Omitted for credentials
   * that are secrets and therefore have no business living in a committed
   * config (e.g. API tokens).
   */
  configKey?: string
  /**
   * Message shown when interactively prompting for this field. Defaults to
   * `"${label}:"` (or `"${label} (optional):"` when `required` is false) —
   * set explicitly only when a field benefits from more context, such as a
   * docs link or an explanation of what leaving it blank does.
   */
  promptMessage?: string
  /**
   * Single-character CLI flag alias (e.g. `'p'` for `--projectId`). Aliases
   * are a scarce, collision-prone resource shared across every provider's
   * flags on the same command, so most fields should leave this unset.
   */
  cliAlias?: string
  /**
   * Vercel-only today: some pre-multi-provider configs stored this value at
   * the config's top level (e.g. `config.projectId`) rather than nested
   * under `providers.<name>`. New providers should leave this unset — it
   * exists purely for backward compatibility with that legacy shape.
   */
  legacyConfigKey?: string
}

/**
 * Everything doorman needs to know about a provider's credentials, declared
 * once, in that provider's own adapter directory.
 */
export interface CredentialDescriptor {
  provider: ProviderType
  fields: CredentialField[]
}

/**
 * Resolves a descriptor's fields against the standard precedence chain:
 * explicit value (CLI flag) → config file → environment variable.
 *
 * This is the order doorman has always used; it's pinned by the precedence
 * tests in `providerHelper.test.ts`, which were deliberately landed before
 * this refactor so a silent reordering would fail loudly rather than leave
 * users authenticated against the wrong project or zone.
 */
export function resolveCredentials(
  descriptor: CredentialDescriptor,
  sources: {
    /** Explicit values, typically CLI flags. Highest precedence. */
    explicit?: Record<string, string | undefined>
    /** Values read from the config file. Middle precedence. */
    config?: Record<string, string | undefined>
    /** Environment lookup, injectable for testing. Defaults to process.env. */
    env?: Record<string, string | undefined>
  } = {},
): Record<string, string | undefined> {
  const { explicit = {}, config = {}, env = process.env } = sources
  const resolved: Record<string, string | undefined> = {}

  for (const field of descriptor.fields) {
    resolved[field.key] = explicit[field.key] || config[field.key] || env[field.envVar]
  }

  return resolved
}

/**
 * Names of the fields a provider cannot be constructed without, for building
 * a "credentials missing" message that actually says which ones.
 */
export function missingRequiredCredentials(
  descriptor: CredentialDescriptor,
  resolved: Record<string, string | undefined>,
): CredentialField[] {
  return descriptor.fields.filter((field) => field.required && !resolved[field.key])
}

/**
 * Every provider's credential descriptor, keyed by provider. Adding a
 * provider means adding its descriptor here alongside its `PROVIDER_TYPES`
 * entry and its `initProviders` registration — not editing resolution,
 * detection, or prompting code.
 */
export const CREDENTIAL_DESCRIPTORS: Record<ProviderType, CredentialDescriptor> = {
  vercel: vercelCredentials,
  cloudflare: cloudflareCredentials,
  fastly: fastlyCredentials,
  gcp: gcpCredentials,
}

/** The credential descriptor for a provider. */
export function getCredentialDescriptor(provider: ProviderType): CredentialDescriptor {
  return CREDENTIAL_DESCRIPTORS[provider]
}
