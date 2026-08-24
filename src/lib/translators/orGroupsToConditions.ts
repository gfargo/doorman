import type { UnifiedCondition } from '../types/unified'

/**
 * Shared by `CelParser` and `WirefilterParser` (#252): converts a top-level
 * OR node's children into `UnifiedCondition[]`, one `group` index per child.
 * Each child is either a leaf (contributes one condition) or a flat AND of
 * leaves (each AND-child contributes a condition sharing that branch's group
 * index) — anything else (a nested OR, an unsupported leaf shape, an unmapped
 * field) makes that branch contribute zero conditions.
 *
 * Fails closed (returns `null`) unless *every* child contributed at least
 * one condition — confirmed byte-for-byte identical between the two parsers
 * before this extraction, and safety-critical: a silently-dropped OR branch
 * would change what the rule matches (e.g. `A or B or C` parsing back as
 * `A or C`), so a partial result is treated the same as total failure.
 */
export function orGroupsToConditions<Node extends { type: string }>(
  children: Node[],
  isLeaf: (node: Node) => boolean,
  isAndNode: (node: Node) => node is Node & { children: Node[] },
  leafToCondition: (node: Node, group: number) => UnifiedCondition | null,
): { conditions: UnifiedCondition[]; conditionLogic: 'OR' } | null {
  const conditions: UnifiedCondition[] = []
  children.forEach((child, groupIndex) => {
    if (isLeaf(child)) {
      const condition = leafToCondition(child, groupIndex)
      if (condition) conditions.push(condition)
      return
    }
    if (isAndNode(child)) {
      for (const grandchild of child.children) {
        if (!isLeaf(grandchild)) return
        const condition = leafToCondition(grandchild, groupIndex)
        if (condition) conditions.push(condition)
      }
    }
  })

  const expectedGroups = children.length
  const actualGroups = new Set(conditions.map((c) => c.group)).size
  if (actualGroups !== expectedGroups) return null
  return { conditions, conditionLogic: 'OR' }
}
