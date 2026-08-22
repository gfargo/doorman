import type { CredentialDescriptor } from '../credentials'

/**
 * Vercel's credentials, declared once here rather than as string literals
 * scattered across the resolution, detection, and prompting code.
 */
export const vercelCredentials: CredentialDescriptor = {
  provider: 'vercel',
  fields: [
    {
      key: 'token',
      envVar: 'VERCEL_TOKEN',
      label: 'Vercel API Token',
      required: true,
      secret: true,
      // Deliberately no configKey — an API token has no business living in a
      // committed config file, so it comes from a flag or the environment only.
      promptMessage:
        'What is your Vercel API Auth Token? (https://vercel.com/guides/how-do-i-use-a-vercel-api-access-token#creating-an-access-token) ',
    },
    {
      key: 'projectId',
      envVar: 'VERCEL_PROJECT_ID',
      label: 'Vercel Project ID',
      required: true,
      configKey: 'projectId',
      cliAlias: 'p',
      legacyConfigKey: 'projectId',
      promptMessage:
        'What is your Vercel Project ID? (See https://vercel.com/docs/projects/project-configuration/general-settings#project-id)',
    },
    {
      key: 'teamId',
      envVar: 'VERCEL_TEAM_ID',
      label: 'Vercel Team ID',
      // Omitting it is safe — Vercel resolves the request against the
      // token's default team, and doorman's own config schema already
      // treats it as optional (see issue #207). Only needed explicitly by
      // callers who belong to more than one team and want a non-default one.
      required: false,
      configKey: 'teamId',
      cliAlias: 't',
      legacyConfigKey: 'teamId',
      promptMessage:
        'What is your Vercel Team ID? Leave blank to use your Vercel default team (every account, including Hobby, is a team). Only needed if you belong to more than one team and want to target a non-default one. (See https://vercel.com/docs/accounts#find-your-team-id)',
    },
  ],
}
