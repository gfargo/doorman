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
