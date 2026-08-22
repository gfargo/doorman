import { credentialOptions, pickCredentialOptions } from '../credentialOptions'

describe('credentialOptions', () => {
  it('declares exactly one yargs option per distinct credential key across every provider', () => {
    // vercel: token, projectId, teamId — cloudflare: apiToken, zoneId,
    // accountId — fastly: apiToken (shared with cloudflare's), workspaceId
    // — gcp: serviceAccountKeyPath, projectId (shared with vercel's),
    // policyName. 9 distinct keys total; apiToken/projectId must not appear
    // twice each despite each being declared by two providers.
    expect(Object.keys(credentialOptions).sort()).toEqual(
      [
        'accountId',
        'apiToken',
        'policyName',
        'projectId',
        'serviceAccountKeyPath',
        'teamId',
        'token',
        'workspaceId',
        'zoneId',
      ].sort(),
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

  it('keeps projectId\'s "-p" alias even though a second provider (gcp) shares the key and declares no alias of its own', () => {
    // Regression guard: the alias lookup must scan every colliding
    // provider's field for one that declares cliAlias, not just check
    // whichever provider happens to be first/only — dropping an existing
    // shortcut the moment a second provider reuses the key would be a real,
    // easy-to-miss regression (this was actually caught by this exact
    // scenario when GCP was added, since GCP's projectId has no alias).
    expect(credentialOptions.projectId?.alias).toBe('p')
  })

  it('mentions every env var for a key shared by more than one provider (apiToken)', () => {
    expect(credentialOptions.apiToken?.description).toContain('CLOUDFLARE_API_TOKEN')
    expect(credentialOptions.apiToken?.description).toContain('FASTLY_API_TOKEN')
  })

  it('accurately describes projectId as shared between Vercel and GCP, not as an API token', () => {
    // Regression guard: describeField's merge branch used to hardcode the
    // phrase "API token" for *any* shared key, which was fine when apiToken
    // was the only real collision but became actively wrong once projectId
    // (Vercel + GCP, semantically unrelated to a token) also collided.
    expect(credentialOptions.projectId?.description).toContain('Vercel Project ID')
    expect(credentialOptions.projectId?.description).toContain('GCP Project ID')
    expect(credentialOptions.projectId?.description).not.toContain('API token')
  })

  it('describes a single-provider field with its label and env var', () => {
    expect(credentialOptions.zoneId?.description).toContain('Cloudflare Zone ID')
    expect(credentialOptions.zoneId?.description).toContain('CLOUDFLARE_ZONE_ID')
  })

  it('flags an optional single-provider field as such in its description', () => {
    expect(credentialOptions.accountId?.description).toContain('(optional)')
    expect(credentialOptions.teamId?.description).toContain('(optional)')
  })

  it('does not flag a required single-provider field as optional', () => {
    expect(credentialOptions.zoneId?.description).not.toContain('(optional)')
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
          policyName: 'pn',
          serviceAccountKeyPath: 'skp',
        }),
      ).toEqual({
        token: 't',
        projectId: 'p',
        teamId: 'tm',
        apiToken: 'a',
        zoneId: 'z',
        accountId: 'acc',
        workspaceId: 'w',
        policyName: 'pn',
        serviceAccountKeyPath: 'skp',
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
        policyName: undefined,
        serviceAccountKeyPath: undefined,
      })
    })
  })
})
