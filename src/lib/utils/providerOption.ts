import { PROVIDER_TYPES } from '../providers/IFirewallProvider'

/**
 * The shared `--provider` yargs option, so the list of valid providers lives
 * in exactly one place (`PROVIDER_TYPES`) rather than being repeated as a
 * `choices: ['vercel', 'cloudflare']` literal in every command's builder.
 *
 * Before this, adding a provider meant a mechanical edit to eight command
 * files that were otherwise entirely provider-agnostic — pure duplication
 * with a real chance of one being missed.
 *
 * Spread into a builder rather than assigned, so a command can still
 * override any individual field:
 *
 * ```ts
 * export const builder = {
 *   provider: providerOption,
 *   // …
 * }
 * ```
 */
export const providerOption = {
  type: 'string' as const,
  choices: PROVIDER_TYPES as unknown as string[],
  description: 'Firewall provider (auto-detected)',
}
