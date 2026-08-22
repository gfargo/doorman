import type { CredentialDescriptor } from '../credentials'

/**
 * GCP Cloud Armor's credentials, declared once here — same pattern as
 * `vercelCredentials`/`cloudflareCredentials`/`fastlyCredentials`, with one
 * deliberate departure: `serviceAccountKeyPath` and `projectId` use GCP's
 * own ecosystem-standard env var names (`GOOGLE_APPLICATION_CREDENTIALS`,
 * `GOOGLE_CLOUD_PROJECT`) rather than a doorman-prefixed one like the other
 * three providers. Every GCP client library, `gcloud`, and most IaC tools
 * already respect these exact names — a user with GCP already configured
 * for anything else almost certainly has them set, and doorman should pick
 * them up for free rather than requiring a redundant, doorman-specific
 * duplicate. `policyName` has no such ecosystem convention (there's no
 * universal "which security policy" concept outside doorman), so it follows
 * the usual `GCP_*` pattern instead.
 *
 * `serviceAccountKeyPath` is optional and not a `secret` — it's a *path* to
 * a key file, not the key material itself, and it's the one credential
 * `CloudArmorClient` doesn't strictly require: when absent, `google-auth-
 * library`'s `GoogleAuth` falls through to Application Default Credentials
 * (gcloud user creds, or the GCE/Cloud Run metadata server) on its own —
 * confirmed via research on #187, every realistic non-interactive auth path
 * resolves through the same `GoogleAuth` machinery regardless. No
 * `configKey`: a filesystem path is environment-specific, not something
 * that belongs in a config file meant to be shared/committed.
 */
export const gcpCredentials: CredentialDescriptor = {
  provider: 'gcp',
  fields: [
    {
      key: 'serviceAccountKeyPath',
      envVar: 'GOOGLE_APPLICATION_CREDENTIALS',
      label: 'GCP Service Account Key Path',
      required: false,
      promptMessage:
        'Path to a GCP service account JSON key file (leave blank to use Application Default Credentials — gcloud auth application-default login, or the GCE/Cloud Run metadata server): ',
    },
    {
      key: 'projectId',
      envVar: 'GOOGLE_CLOUD_PROJECT',
      label: 'GCP Project ID',
      required: true,
      configKey: 'projectId',
    },
    {
      key: 'policyName',
      envVar: 'GCP_POLICY_NAME',
      label: 'Cloud Armor Security Policy Name',
      required: true,
      configKey: 'policyName',
    },
  ],
}
