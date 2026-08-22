import consola from 'consola'

/**
 * Prompts the user with a message and options, and returns the user's response.
 * If the user cancels the prompt, the process exits with code 0.
 *
 * @note This is a wrapper to exit the process if the user presses CTRL+C.
 *
 * @param message - The message to display to the user.
 * @param options - The options to provide to the prompt.
 * @returns The user's response.
 */
export const prompt: typeof consola.prompt = async (message, options) => {
  // consola.prompt has no TTY check of its own — without stdin attached to a
  // real terminal it throws a raw libuv error ("TTY initialization failed:
  // uv_tty_init returned EINVAL") from deep inside Node internals. Guard
  // here, once, for every caller (init/template/add/remove/...) rather than
  // in each command — see #221.
  if (!process.stdin.isTTY) {
    throw new Error(
      `Cannot prompt for "${message}" — no interactive terminal available. ` +
        `Re-run with the appropriate non-interactive flag for this command (e.g. --interactive=false, --ci, --force).`,
    )
  }

  const response = await consola.prompt(message, options)

  // An empty optional text prompt resolves to `undefined`/`null`, not the cancel symbol.
  if (response != null && response.toString() === 'Symbol(clack:cancel)') {
    process.exit(0)
  }

  // A text prompt submitted with no input (and no `default`) resolves to `undefined`
  // rather than an empty string, which crashes callers that call `.trim()`/`.length`
  // on the result unconditionally. Normalize it to a string so text prompts always
  // return a string, matching what every caller assumes.
  if ((!options?.type || options.type === 'text') && response === undefined) {
    // consola.prompt's generic conditional return type can't express "always a
    // string for text prompts" here, so a type assertion is the pragmatic escape hatch.
    return '' as any
  }

  return response
}
