/**
 * A complete mock of the consola-based logger, covering every method used
 * anywhere in the command call chain (withCredentials/ProviderDetector call
 * `logger.debug`, list.ts calls `logger.verbose`, etc). Using a partial mock
 * is a trap: an unstubbed method throws `TypeError: logger.x is not a
 * function` deep inside withCredentials' try/catch, which gets silently
 * swallowed by handleCommandError and reported as a generic command failure.
 */
export function createLoggerMock() {
  return {
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    start: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    ready: jest.fn(),
    box: jest.fn(),
    fail: jest.fn(),
    silent: jest.fn(),
    level: 3,
  }
}

/**
 * consola methods excluded by getStdoutText below: `warn`/`error`/`fatal`/
 * `fail` write to stderr in the real CLI, and `debug`/`verbose`/`trace`/
 * `silent` are gated by consola's default log level (3, matching this
 * mock's `level: 3`) and print nothing at all unless `--debug` raises it —
 * unlike this mock, where every method is an unconditional jest.fn() with
 * no level-gating, so calling one always records a call whether or not the
 * real CLI would have printed anything.
 */
const NON_DEFAULT_STDOUT_METHODS = new Set(['warn', 'error', 'fatal', 'fail', 'debug', 'verbose', 'trace', 'silent'])

/**
 * Reconstructs, in real invocation order, everything a command actually
 * wrote to stdout — across *every* mocked logger method, not just one.
 *
 * Inspecting a single method's calls (e.g. `logger.log.mock.calls`) misses
 * pollution from a different method (`logger.start`, `logger.info`) that
 * lands on the same real stdout stream ahead of or after it — which is
 * exactly how the #209 JSON-format bugs shipped with passing tests: each
 * test checked one method in isolation, never what a real
 * `doorman ... --format json | jq` pipeline would receive. Use this instead
 * whenever a test needs to assert something about the whole output stream
 * (e.g. "this is valid, parseable JSON with nothing else mixed in").
 */
export function getStdoutText(logger: ReturnType<typeof createLoggerMock>): string {
  const calls: { order: number; text: string }[] = []

  for (const [name, fn] of Object.entries(logger)) {
    if (NON_DEFAULT_STDOUT_METHODS.has(name) || !jest.isMockFunction(fn)) continue
    fn.mock.calls.forEach((args: unknown[], i: number) => {
      calls.push({
        order: fn.mock.invocationCallOrder[i] ?? 0,
        text: args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
      })
    })
  }

  return calls
    .sort((a, b) => a.order - b.order)
    .map((c) => c.text)
    .join('\n')
}
