import { config } from 'dotenv'
import yargs, { CommandModule } from 'yargs'
import { commands } from '../src/commands'

config()

async function main() {
  const chalk = (await import('chalk')).default

  const run = yargs(process.argv.slice(2))
  run.usage(`${chalk.bold('🚪 Doorman')}\n\n${chalk.dim('Manage firewall rules as code across multiple providers')}`)

  for (const command of commands) {
    run.command(command as CommandModule)
  }

  run
    .demandCommand(1, 'You need at least one command before moving on')
    .help()
    .epilogue(chalk.dim(`See ${chalk.bold('https://doorman.griffen.codes/getting-started')} for more info`)).argv
}

main().catch(console.error)
