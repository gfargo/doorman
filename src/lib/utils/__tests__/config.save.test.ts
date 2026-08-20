jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

// `fs`'s exports aren't configurable, so jest.spyOn can't redefine them.
// Mock the module instead, delegating to the real implementation by default
// so only the specific call a test wants to fail is overridden.
jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    writeFileSync: jest.fn((...args: unknown[]) => actual.writeFileSync(...args)),
    renameSync: jest.fn((...args: unknown[]) => actual.renameSync(...args)),
  }
})

import { promises as fsp, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { saveConfig } from '../config'
import { ValidationService } from '../../services/ValidationService'
import type { FirewallConfig } from '../../types'

const mockedWriteFileSync = writeFileSync as unknown as jest.Mock
const mockedRenameSync = renameSync as unknown as jest.Mock

const validConfig: FirewallConfig = { version: 1, rules: [], ips: [] }
const previousConfig: FirewallConfig = { version: 7, rules: [], ips: [] }

/** Writes bypassing the mock, so fixture setup can't be affected by it. */
const writeReal = (path: string, contents: string) =>
  (jest.requireActual('fs') as typeof import('fs')).writeFileSync(path, contents)

describe('saveConfig', () => {
  let dir: string
  let configPath: string

  beforeEach(() => {
    mockedWriteFileSync.mockClear()
    mockedRenameSync.mockClear()
    dir = mkdtempSync(join(tmpdir(), 'doorman-save-'))
    configPath = join(dir, '.doorman.json')
  })

  afterEach(async () => {
    mockedWriteFileSync.mockReset()
    mockedRenameSync.mockReset()
    const actual = jest.requireActual('fs') as {
      writeFileSync: (...a: never[]) => void
      renameSync: (...a: never[]) => void
    }
    mockedWriteFileSync.mockImplementation((...args: never[]) => actual.writeFileSync(...args))
    mockedRenameSync.mockImplementation((...args: never[]) => actual.renameSync(...args))
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it('writes the config', async () => {
    await saveConfig(validConfig, configPath)

    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(validConfig)
  })

  it('leaves no temp files behind on success', async () => {
    await saveConfig(validConfig, configPath)

    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })

  it('writes via a temp file rather than straight to the target', async () => {
    await saveConfig(validConfig, configPath)

    // The real write goes to a .tmp path; the target only ever appears via rename.
    const writtenPath = mockedWriteFileSync.mock.calls[0]![0] as string
    expect(writtenPath).not.toBe(configPath)
    expect(writtenPath.endsWith('.tmp')).toBe(true)
    expect(mockedRenameSync).toHaveBeenCalledWith(writtenPath, configPath)
  })

  // The point of the atomic write: `sync` saves this file *after* mutating
  // the remote firewall, so a partial write would destroy the user's source
  // of truth while the live firewall had already changed.
  //
  // Note a throwing mock can't simulate a genuinely *partial* write — the
  // guarantee against that comes from the structure, covered by the
  // "writes via a temp file" test above: the target is never written
  // directly, so it can never be left half-written.
  describe('atomicity', () => {
    it('leaves the previous config intact when the write fails', async () => {
      writeReal(configPath, JSON.stringify(previousConfig, null, 2))
      mockedWriteFileSync.mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device')
      })

      await expect(saveConfig(validConfig, configPath)).rejects.toThrow('ENOSPC')

      // Untouched — not truncated, not empty, still parseable.
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(previousConfig)
    })

    it('leaves the previous config intact when the rename fails', async () => {
      writeReal(configPath, JSON.stringify(previousConfig, null, 2))
      mockedRenameSync.mockImplementation(() => {
        throw new Error('EXDEV: cross-device link not permitted')
      })

      await expect(saveConfig(validConfig, configPath)).rejects.toThrow('EXDEV')

      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(previousConfig)
    })

    it('cleans up the temp file when the rename fails', async () => {
      writeReal(configPath, JSON.stringify(previousConfig, null, 2))
      mockedRenameSync.mockImplementation(() => {
        throw new Error('EXDEV')
      })

      await expect(saveConfig(validConfig, configPath)).rejects.toThrow()

      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    })
  })

  describe('validation options', () => {
    const invalidConfig = { rules: [{ name: 'no conditions' }] } as unknown as FirewallConfig

    it('validates and throws by default', async () => {
      await expect(saveConfig(invalidConfig, configPath)).rejects.toThrow()
    })

    it('skips validation entirely when validate is false', async () => {
      await expect(saveConfig(invalidConfig, configPath, { validate: false })).resolves.toBeUndefined()
    })

    // Regression: the previous default-object-literal signature meant passing
    // `{ throwOnError: false }` alone left `validate` undefined, so validation
    // was skipped altogether rather than run-but-not-thrown.
    it('still validates when only throwOnError is passed, but does not throw', async () => {
      const spy = jest.spyOn(ValidationService.getInstance(), 'validateConfig')

      await expect(saveConfig(invalidConfig, configPath, { throwOnError: false })).resolves.toBeUndefined()

      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
