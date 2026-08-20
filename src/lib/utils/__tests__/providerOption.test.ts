import { providerOption } from '../providerOption'
import { PROVIDER_TYPES } from '../../providers/IFirewallProvider'

// Regression coverage for #181: `choices: ['vercel', 'cloudflare']` used to
// be duplicated verbatim across all eight command builders, so adding a
// provider meant eight mechanical edits to files that are otherwise entirely
// provider-agnostic — with a real chance of missing one.
describe('providerOption', () => {
  it('derives its choices from PROVIDER_TYPES rather than a hardcoded list', () => {
    expect(providerOption.choices).toEqual([...PROVIDER_TYPES])
  })

  it('is a string option', () => {
    expect(providerOption.type).toBe('string')
  })

  it('has a description', () => {
    expect(providerOption.description).toBeTruthy()
  })
})

describe('every command builder uses the shared provider option', () => {
  const commands = ['sync', 'diff', 'download', 'list', 'status', 'watch', 'backup', 'export']

  it.each(commands)('%s exposes the shared providerOption', (name) => {
    const mod = require(`../../../commands/${name}`) as { builder: Record<string, unknown> }

    expect(mod.builder.provider).toBe(providerOption)
  })
})
