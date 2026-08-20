import { vercelToUnified, unifiedToVercel, vercelIPToUnified } from '../providers/vercel/translator'
import { cloudflareToUnified, unifiedToCloudflare, unifiedIPToCloudflare } from '../providers/cloudflare/translator'
import {
  fastlyToUnified,
  unifiedToFastly,
  fastlyListEntriesToUnified,
  unifiedIPsToFastlyEntries,
} from '../providers/fastly/translator'

export type {
  TranslationWarningSeverity,
  TranslationWarningCategory,
  TranslationWarning,
  TranslationResult,
} from './TranslationTypes'

/**
 * Rule translator between different firewall providers.
 *
 * Kept as a static-method facade (rather than requiring every call site to
 * import each provider's translator module directly) so existing callers
 * — `CloudflareFirewallService`, `VercelFirewallService`, `vercelConfigAdapter`
 * — didn't need to change when the underlying logic split into per-adapter
 * modules (#196). Each method here is just the corresponding provider's
 * function; add a new provider's translator to its own directory
 * (`src/lib/providers/<name>/translator.ts`) rather than to this file.
 *
 * `RuleTranslator.vercelToCloudflare`/`cloudflareToVercel` (direct
 * provider-to-provider translation, bypassing Unified) were removed here —
 * confirmed via repo-wide search to have had zero production callers since
 * the Unified-config model replaced direct cross-provider translation; only
 * their own tests exercised them.
 */
export class RuleTranslator {
  static vercelToUnified = vercelToUnified
  static unifiedToVercel = unifiedToVercel
  static vercelIPToUnified = vercelIPToUnified

  static cloudflareToUnified = cloudflareToUnified
  static unifiedToCloudflare = unifiedToCloudflare
  static unifiedIPToCloudflare = unifiedIPToCloudflare

  static fastlyToUnified = fastlyToUnified
  static unifiedToFastly = unifiedToFastly
  static fastlyListEntriesToUnified = fastlyListEntriesToUnified
  static unifiedIPsToFastlyEntries = unifiedIPsToFastlyEntries
}
