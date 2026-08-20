import type { CredentialDescriptor } from '../credentials'

/**
 * Cloudflare's credentials, declared once here rather than as string
 * literals scattered across the resolution, detection, validation, and
 * setup-verification code.
 */
export const cloudflareCredentials: CredentialDescriptor = {
  provider: 'cloudflare',
  fields: [
    {
      key: 'apiToken',
      envVar: 'CLOUDFLARE_API_TOKEN',
      label: 'Cloudflare API Token',
      required: true,
      secret: true,
      // No configKey — see the Vercel token's note.
    },
    {
      key: 'zoneId',
      envVar: 'CLOUDFLARE_ZONE_ID',
      label: 'Cloudflare Zone ID',
      required: true,
      configKey: 'zoneId',
    },
    {
      key: 'accountId',
      envVar: 'CLOUDFLARE_ACCOUNT_ID',
      // Optional: only needed for the Lists API (bulk IP blocking). Without
      // it, IP rules fall back to individual rules — degraded, not broken.
      label: 'Cloudflare Account ID',
      required: false,
      configKey: 'accountId',
    },
  ],
}
