import type { CredentialDescriptor } from '../credentials'

/**
 * Fastly's credentials, declared once here rather than as string literals
 * scattered across the resolution, detection, and prompting code — same
 * pattern as `vercelCredentials`/`cloudflareCredentials`.
 */
export const fastlyCredentials: CredentialDescriptor = {
  provider: 'fastly',
  fields: [
    {
      key: 'apiToken',
      envVar: 'FASTLY_API_TOKEN',
      label: 'Fastly API Token',
      required: true,
      secret: true,
      // No configKey — see the Vercel/Cloudflare tokens' equivalent note.
    },
    {
      key: 'workspaceId',
      envVar: 'FASTLY_WORKSPACE_ID',
      label: 'Fastly Next-Gen WAF Workspace ID',
      required: true,
      configKey: 'workspaceId',
    },
  ],
}
