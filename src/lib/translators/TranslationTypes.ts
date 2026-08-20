/**
 * Types shared by every provider's translator and by `TranslationWarningSystem`.
 *
 * Split out of `RuleTranslator.ts` so per-adapter translator modules
 * (`src/lib/providers/vercel/translator.ts`, `.../cloudflare/translator.ts`)
 * and `TranslationWarningSystem.ts` can all depend on these types without
 * depending on each other — previously `TranslationWarningSystem.ts` imported
 * these from `RuleTranslator.ts` while `RuleTranslator.ts`'s methods lazily
 * `require()`d `TranslationWarningSystem` at call time specifically to dodge
 * the circular import that would otherwise create. That workaround is gone
 * now that the types have a home neither file needs to reach into the other for.
 */

/**
 * Translation warning severity levels
 */
export type TranslationWarningSeverity = 'critical' | 'warning' | 'info'

/**
 * Translation warning categories for better organization
 */
export type TranslationWarningCategory =
  | 'feature_unsupported'
  | 'lossy_conversion'
  | 'syntax_limitation'
  | 'performance_impact'
  | 'security_consideration'
  | 'compatibility_issue'

/**
 * Enhanced translation warnings with severity levels and actionable suggestions
 */
export interface TranslationWarning {
  rule?: string
  field?: string
  category: TranslationWarningCategory
  message: string
  explanation: string
  severity: TranslationWarningSeverity
  suggestion?: string
  alternativeApproach?: string
  impact?: string
  docsUrl?: string
}

/**
 * Translation result
 */
export interface TranslationResult<T> {
  result: T
  warnings: TranslationWarning[]
}
