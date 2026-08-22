import { templates } from '../index'

describe('templates', () => {
  it('gives every rule a stable, deterministic id (regression test for #217)', () => {
    const rulesMissingIds = Object.entries(templates).flatMap(([templateName, template]) =>
      template.config.rules.filter((rule) => !rule.id).map((rule) => `${templateName}: "${rule.name}"`),
    )
    expect(rulesMissingIds).toEqual([])
  })

  it("wordpress template's rule id matches Vercel's own generated id for the same rule name", () => {
    const wordpress = templates.wordpress
    expect(wordpress?.config.rules[0]?.id).toBe('rule_deny_word_press_ur_ls')
  })
})
