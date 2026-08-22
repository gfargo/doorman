import { credentialOptions, pickCredentialOptions } from '../credentialOptions'

describe('credentialOptions', () => {
  it('declares exactly one yargs option per distinct credential key across every provider', () => {
    // vercel: token, projectId, teamId — cloudflare: apiToken, zoneId, accountId
    // — fastly: apiToken (shared with cloudflare's), workspaceId. 7 distinct
    // keys total; apiToken must not appear twice.
    expect(Object.keys(credentialOptions).sort()).toEqual(
      ['accountId', 'apiToken', 'projectId', 'teamId', 'token', 'workspaceId', 'zoneId'].sort(),
    )
  })

  it('carries the cliAlias declared on a field (projectId -> p, teamId -> t)', () => {
    expect(credentialOptions.projectId).toMatchObject({ alias: 'p' })
    expect(credentialOptions.teamId).toMatchObject({ alias: 't' })
  })

  it('leaves alias unset for fields with no cliAlias', () => {
    expect(credentialOptions.zoneId?.alias).toBeUndefined()
    expect(credentialOptions.workspaceId?.alias).toBeUndefined()
  })

  it('mentions every env var for a key shared by more than one provider (apiToken)', () => {
    expect(credentialOptions.apiToken?.description).toContain('CLOUDFLARE_API_TOKEN')
    expect(credentialOptions.apiToken?.description).toContain('FASTLY_API_TOKEN')
  })

  it('describes a single-provider field with its label and env var', () => {
    expect(credentialOptions.zoneId?.description).toContain('Cloudflare Zone ID')
    expect(credentialOptions.zoneId?.description).toContain('CLOUDFLARE_ZONE_ID')
  })

  it('flags an optional field as such in its description', () => {
    expect(credentialOptions.accountId?.description).toContain('(optional)')
    expect(credentialOptions.teamId?.description).toContain('(optional)')
  })

  it('does not flag a required field as optional', () => {
    expect(credentialOptions.zoneId?.description).not.toContain('(optional)')
    expect(credentialOptions.projectId?.description).not.toContain('(optional)')
  })

  describe('pickCredentialOptions', () => {
    it('extracts every credential value, dropping provider', () => {
      expect(
        pickCredentialOptions({
          provider: 'vercel',
          token: 't',
          projectId: 'p',
          teamId: 'tm',
          apiToken: 'a',
          zoneId: 'z',
          accountId: 'acc',
          workspaceId: 'w',
        }),
      ).toEqual({
        token: 't',
        projectId: 'p',
        teamId: 'tm',
        apiToken: 'a',
        zoneId: 'z',
        accountId: 'acc',
        workspaceId: 'w',
      })
    })

    it('leaves unset fields undefined rather than omitting them', () => {
      expect(pickCredentialOptions({})).toEqual({
        token: undefined,
        projectId: undefined,
        teamId: undefined,
        apiToken: undefined,
        zoneId: undefined,
        accountId: undefined,
        workspaceId: undefined,
      })
    })
  })
})
