import { BASIC_TEMPLATE_RULES, SECURITY_FOCUSED_TEMPLATE_RULES } from '../init'
import { firewallConfigSchema } from '../../lib/schemas/firewallSchemas'
import { createEmptyConfig } from '../../lib/utils/createEmptyConfig'

describe('init command templates', () => {
  it('produces a schema-valid config for the basic template', () => {
    const config = { ...createEmptyConfig(), rules: BASIC_TEMPLATE_RULES }
    const result = firewallConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })

  it('produces a schema-valid config for the security-focused template', () => {
    const config = { ...createEmptyConfig(), rules: SECURITY_FOCUSED_TEMPLATE_RULES }
    const result = firewallConfigSchema.safeParse(config)
    expect(result.success).toBe(true)
  })
})
