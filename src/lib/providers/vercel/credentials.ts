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
    },
    {
      key: 'projectId',
      envVar: 'VERCEL_PROJECT_ID',
      label: 'Vercel Project ID',
      required: true,
      configKey: 'projectId',
    },
    {
      key: 'teamId',
      envVar: 'VERCEL_TEAM_ID',
      label: 'Vercel Team ID',
      required: true,
      configKey: 'teamId',
    },
  ],
}
