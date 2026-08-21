import { prompt } from './prompt'
import { promptSecret } from './promptSecret'

export async function promptForCredentials(args: {
  token?: string
  teamId?: string
  projectId?: string
}): Promise<{ token: string; teamId?: string; projectId: string }> {
  const token =
    args.token ||
    process.env.VERCEL_TOKEN ||
    (await promptSecret(
      `What is your Vercel API Auth Token? (https://vercel.com/guides/how-do-i-use-a-vercel-api-access-token#creating-an-access-token) `,
    ))

  const teamIdAnswer =
    args.teamId ||
    process.env.VERCEL_TEAM_ID ||
    (await prompt(
      `What is your Vercel Team ID? Leave blank to use your Vercel default team (every account, including Hobby, is a team). Only needed if you belong to more than one team and want to target a non-default one. (See https://vercel.com/docs/accounts#find-your-team-id)`,
      { type: 'text' },
    ))
  // An empty answer means "use my Vercel default team" — normalize to
  // `undefined` rather than carrying a `''` team ID through to the API
  // client, which omits the param entirely and lets Vercel resolve it.
  const teamId = teamIdAnswer || undefined

  const projectId =
    args.projectId ||
    process.env.VERCEL_PROJECT_ID ||
    (await prompt(
      `What is your Vercel Project ID? (See https://vercel.com/docs/projects/project-configuration/general-settings#project-id)`,
      { type: 'text' },
    ))

  return { token, teamId, projectId }
}
