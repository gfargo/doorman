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
