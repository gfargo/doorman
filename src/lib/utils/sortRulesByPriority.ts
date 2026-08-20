import type { UnifiedRule } from '../types/unified'

/**
 * Orders rules for submission to a provider, honouring `UnifiedRule.priority`.
 *
 * Semantics (documented in the JSON schema and README):
 *   - **Lower number wins** — `priority: 1` is evaluated before `priority: 10`.
 *     This matches every provider that exposes an explicit numeric priority
 *     (AWS WAF `Priority`, GCP Cloud Armor `priority`), so a config written
 *     against one provider's convention keeps its meaning on another.
 *   - Rules **without** a priority keep their original config-file order and
 *     sort *after* every prioritised rule. Adding `priority: 1` to one rule in
 *     an otherwise unprioritised config therefore promotes it to the front,
 *     which is the intent that action almost always expresses.
 *   - Equal priorities keep their relative config-file order (the sort is
 *     stable, per ES2019+).
 *
 * Returns a new array; the input is not mutated.
 */
export function sortRulesByPriority<T extends Pick<UnifiedRule, 'priority'>>(rules: T[]): T[] {
  return [...rules].sort((a, b) => {
    const aHas = a.priority !== undefined
    const bHas = b.priority !== undefined

    if (!aHas && !bHas) return 0
    if (!aHas) return 1
    if (!bHas) return -1
    return a.priority! - b.priority!
  })
}

/**
 * Whether any rule in the set declares an explicit priority. Used to decide
 * whether to surface a warning on providers that can't fully honour ordering
 * (see `VercelFirewallService.syncRules`) — a config that never sets
 * `priority` shouldn't be nagged about ordering it never asked for.
 */
export function hasExplicitPriorities(rules: Pick<UnifiedRule, 'priority'>[]): boolean {
  return rules.some((rule) => rule.priority !== undefined)
}
