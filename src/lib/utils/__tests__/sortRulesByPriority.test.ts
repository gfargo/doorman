import { sortRulesByPriority, hasExplicitPriorities } from '../sortRulesByPriority'

type R = { name: string; priority?: number }

const names = (rules: R[]) => rules.map((r) => r.name)

describe('sortRulesByPriority', () => {
  it('orders lower priority numbers first', () => {
    const rules: R[] = [
      { name: 'c', priority: 30 },
      { name: 'a', priority: 10 },
      { name: 'b', priority: 20 },
    ]

    expect(names(sortRulesByPriority(rules))).toEqual(['a', 'b', 'c'])
  })

  it('sorts unprioritised rules after every prioritised one', () => {
    const rules: R[] = [{ name: 'no-priority-1' }, { name: 'explicit', priority: 5 }, { name: 'no-priority-2' }]

    expect(names(sortRulesByPriority(rules))).toEqual(['explicit', 'no-priority-1', 'no-priority-2'])
  })

  it('preserves config order among unprioritised rules', () => {
    const rules: R[] = [{ name: 'x' }, { name: 'y' }, { name: 'z' }]

    expect(names(sortRulesByPriority(rules))).toEqual(['x', 'y', 'z'])
  })

  it('preserves config order among equal priorities (stable sort)', () => {
    const rules: R[] = [
      { name: 'first', priority: 1 },
      { name: 'second', priority: 1 },
      { name: 'third', priority: 1 },
    ]

    expect(names(sortRulesByPriority(rules))).toEqual(['first', 'second', 'third'])
  })

  it('handles priority 0 as a real value rather than falsy-absent', () => {
    const rules: R[] = [{ name: 'ten', priority: 10 }, { name: 'zero', priority: 0 }, { name: 'none' }]

    expect(names(sortRulesByPriority(rules))).toEqual(['zero', 'ten', 'none'])
  })

  it('handles negative priorities', () => {
    const rules: R[] = [
      { name: 'zero', priority: 0 },
      { name: 'negative', priority: -5 },
    ]

    expect(names(sortRulesByPriority(rules))).toEqual(['negative', 'zero'])
  })

  it('does not mutate the input array', () => {
    const rules: R[] = [
      { name: 'b', priority: 20 },
      { name: 'a', priority: 10 },
    ]

    sortRulesByPriority(rules)

    expect(names(rules)).toEqual(['b', 'a'])
  })

  it('returns an empty array unchanged', () => {
    expect(sortRulesByPriority([])).toEqual([])
  })
})

describe('hasExplicitPriorities', () => {
  it('is false when no rule declares a priority', () => {
    expect(hasExplicitPriorities([{ priority: undefined }, {}])).toBe(false)
  })

  it('is true when at least one rule declares a priority', () => {
    expect(hasExplicitPriorities([{}, { priority: 3 }])).toBe(true)
  })

  it('treats priority 0 as explicit', () => {
    expect(hasExplicitPriorities([{ priority: 0 }])).toBe(true)
  })

  it('is false for an empty set', () => {
    expect(hasExplicitPriorities([])).toBe(false)
  })
})
