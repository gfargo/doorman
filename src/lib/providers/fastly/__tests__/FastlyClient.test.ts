import { FastlyClient } from '../FastlyClient'
import type { FastlyRuleInput } from '../../../types/fastly'

jest.mock('../../../logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Regression coverage for the same bug class as #195 (Vercel's rules.insert):
// creating a rule/list has no client-supplied id, so a retry after a lost
// response duplicates it rather than safely re-applying. Update/delete are
// keyed by id and stay safe to retry.
describe('FastlyClient', () => {
  const workspaceId = 'workspace_1'
  const apiToken = 'test-token'
  let client: FastlyClient
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    client = new FastlyClient(workspaceId, apiToken)
    jest.spyOn(client as any, 'delay').mockResolvedValue(undefined)
    fetchSpy = jest.spyOn(globalThis, 'fetch')
    jest.clearAllMocks()
    jest.spyOn(client as any, 'delay').mockResolvedValue(undefined)
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  const ruleInput: FastlyRuleInput = {
    type: 'request',
    enabled: true,
    description: 'Block bad bots',
    group_operator: 'all',
    conditions: [{ type: 'single', field: 'user_agent', operator: 'contains', value: 'BadBot' }],
    actions: [{ type: 'block' }],
  }

  describe('createRule', () => {
    it('does not retry after a network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'))

      await expect(client.createRule(ruleInput)).rejects.toThrow()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateRule', () => {
    it('still retries after a network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'))

      await expect(client.updateRule('rule_1', ruleInput)).rejects.toThrow()

      // Default `retries: 3` -> up to 4 attempts total.
      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1)
    })
  })

  describe('createList', () => {
    it('does not retry after a network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'))

      await expect(client.createList('doorman-managed-deny', ['1.2.3.4/32'])).rejects.toThrow()

      expect(fetchSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateListEntries', () => {
    it('still retries after a network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('fetch failed'))

      await expect(client.updateListEntries('list_1', ['1.2.3.4/32'])).rejects.toThrow()

      expect(fetchSpy.mock.calls.length).toBeGreaterThan(1)
    })
  })
})
