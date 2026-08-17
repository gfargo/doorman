import { prompt } from './prompt'
import { promptSecret } from './promptSecret'

export async function promptForCredentials(args: {
  token?: string
  teamId?: string
  projectId?: string
}): Promise<{ token: string; teamId: string; projectId: string }> {
  const token =
    args.token ||
    process.env.VERCEL_TOKEN ||
    (await promptSecret(
      `What is your Vercel API Auth Token? (https://vercel.com/guides/how-do-i-use-a-vercel-api-access-token#creating-an-access-token) `,
    ))

  const teamId =
    args.teamId ||
    process.env.VERCEL_TEAM_ID ||
    (await prompt(
      `What is your Vercel Team ID? (See https://vercel.com/docs/accounts/create-a-team#find-your-team-id)`,
      { type: 'text' },
    ))

  const projectId =
    args.projectId ||
    process.env.VERCEL_PROJECT_ID ||
    (await prompt(
      `What is your Vercel Project ID? (See https://vercel.com/docs/projects/project-configuration/general-settings#project-id)`,
      { type: 'text' },
    ))

  return { token, teamId, projectId }
}
