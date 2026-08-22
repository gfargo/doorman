import { PROVIDER_TYPES, type ProviderType } from '../providers/IFirewallProvider'
import { CREDENTIAL_DESCRIPTORS } from '../providers/credentials'
import type { CredentialField } from '../providers/credentials'

/**
 * Every provider's credential flags, flattened onto one options shape.
 *
 * Before this, each of the 8 credential-consuming commands hand-declared
 * the same 7 fields (`token`, `projectId`, `teamId`, `apiToken`, `zoneId`,
 * `accountId`, `workspaceId`) in its own local options interface — pure
 * duplication with a real chance of one being missed when a provider's
 * credentials changed (see #182). `apiToken` is deliberately shared by both
 * Cloudflare and Fastly, and `projectId` by both Vercel and GCP — one flag
 * each, resolved against whichever provider is active — the same way
 * `apiToken` always has been; two providers happening to use the same
 * credential *key* doesn't imply their values mean the same thing (a Vercel
 * project ID and a GCP project ID are unrelated strings), only that they
 * share a CLI flag name and are never both in play in the same command.
 *
 * Adding a provider whose credentials don't fit this exact field set still
 * means editing this interface (and `pickCredentialOptions` below) once —
 * but once, here, instead of 8 times.
 */
export interface CredentialOptions {
  provider?: ProviderType
  token?: string
  projectId?: string
  teamId?: string
  apiToken?: string
  zoneId?: string
  accountId?: string
  workspaceId?: string
  policyName?: string
  serviceAccountKeyPath?: string
}

interface YargsCredentialOption {
  type: 'string'
  alias?: string
  description: string
}

function describeField(entries: { provider: ProviderType; field: CredentialField }[]): string {
  if (entries.length === 1) {
    const { field } = entries[0]!
    const optional = field.required ? '' : ' (optional)'
    const configFallback = field.configKey ? ' or config file' : ''
    return `${field.label}${optional} (defaults to ${field.envVar} env var${configFallback})`
  }

  // A CLI flag shared by more than one provider's descriptor (`apiToken`
  // for Cloudflare/Fastly, `projectId` for Vercel/GCP) — describe every
  // provider's own field generically rather than assuming what's being
  // shared. Every field's `label` already names its provider (e.g. "GCP
  // Project ID"), so no need to also prefix `getProviderDisplayName` here.
  const perField = entries.map((e) => `${e.field.label} (${e.field.envVar})`).join(' / ')
  return `Resolved against whichever provider is active: ${perField}`
}

const fieldsByKey = new Map<string, { provider: ProviderType; field: CredentialField }[]>()
for (const providerType of PROVIDER_TYPES) {
  for (const field of CREDENTIAL_DESCRIPTORS[providerType].fields) {
    const entries = fieldsByKey.get(field.key) ?? []
    entries.push({ provider: providerType, field })
    fieldsByKey.set(field.key, entries)
  }
}

/**
 * The shared credential flags, spread into a command's yargs `builder`
 * alongside `provider: providerOption`:
 *
 * ```ts
 * export const builder = {
 *   config: { ... },
 *   provider: providerOption,
 *   ...credentialOptions,
 *   // command-specific flags
 * }
 * ```
 */
export const credentialOptions: Record<string, YargsCredentialOption> = Object.fromEntries(
  Array.from(fieldsByKey.entries()).map(([key, entries]) => {
    // An alias is a shortcut for the flag itself, not a claim about what it
    // means — harmless to keep even when the key is shared, and dropping it
    // just because a second provider's same-named field doesn't declare one
    // would silently take away an existing shortcut (e.g. -p for
    // --projectId) the moment a colliding provider is added.
    const cliAlias = entries.map((e) => e.field.cliAlias).find((alias): alias is string => !!alias)
    return [
      key,
      {
        type: 'string' as const,
        ...(cliAlias ? { alias: cliAlias } : {}),
        description: describeField(entries),
      },
    ]
  }),
)

/**
 * Pulls just the credential *values* off a parsed `argv` — everything
 * `CredentialOptions` declares except `provider`, which is provider
 * *selection*, not a credential, and is threaded separately. Returns the
 * plain bag shape `getProviderInstance`'s `credentials` option expects,
 * without also spreading yargs' own `_`/`$0` internals or this command's
 * other, unrelated flags.
 */
export function pickCredentialOptions(argv: CredentialOptions): Record<string, string | undefined> {
  return {
    token: argv.token,
    projectId: argv.projectId,
    teamId: argv.teamId,
    apiToken: argv.apiToken,
    zoneId: argv.zoneId,
    accountId: argv.accountId,
    workspaceId: argv.workspaceId,
    policyName: argv.policyName,
    serviceAccountKeyPath: argv.serviceAccountKeyPath,
  }
}
