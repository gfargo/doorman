import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { randomBytes } from 'crypto'
import { dirname } from 'path'
import { logger } from '../logger'
import { ValidationService } from '../services/ValidationService'
import { FirewallConfig } from '../types'
import { ConfigFinder } from './configFinder'

/**
 * Config loading mode:
 * - 'required': File must exist and pass validation. Throws on any failure. (default)
 * - 'optional': File may not exist — returns empty config if missing. Still validates if found.
 * - 'raw': File must exist but skip schema validation. Use when the caller validates separately.
 * - 'lenient': File must exist, validate but don't throw on validation errors. Use for template.
 */
export type ConfigLoadMode = 'required' | 'optional' | 'raw' | 'lenient'

/**
 * @deprecated Use `mode` parameter instead. Kept for backward compatibility.
 */
interface LegacyConfigOptions {
  validate?: boolean
  throwOnError?: boolean
}

interface ConfigSaveOptions {
  validate?: boolean
  throwOnError?: boolean
}

/**
 * Load a firewall config file.
 *
 * @param configPath - Explicit path to config file, or undefined to auto-discover
 * @param modeOrOptions - Loading mode string or legacy options object
 */
export async function getConfig(
  configPath?: string,
  modeOrOptions: ConfigLoadMode | LegacyConfigOptions = 'required',
): Promise<FirewallConfig> {
  // Resolve mode from legacy options for backward compatibility
  const mode = resolveMode(modeOrOptions)

  // Find config file
  const filePath = configPath || (await ConfigFinder.findConfig())

  if (!filePath || !existsSync(filePath)) {
    if (mode === 'optional') {
      logger.debug('No config file found, returning empty config')
      return {} as FirewallConfig
    }
    const defaultPath = ConfigFinder.getDefaultConfigPath()
    throw new Error(
      `No config file found. Run \`doorman init\` to create one at ${defaultPath}, ` +
        `or use --config to specify a custom path.`,
    )
  }

  // Read and parse
  let configJson: FirewallConfig
  try {
    const configContent = readFileSync(filePath, 'utf8')
    configJson = JSON.parse(configContent)
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file (${filePath}): ${error.message}`)
    }
    throw error
  }

  // Validate unless raw mode
  if (mode !== 'raw') {
    try {
      const validator: ValidationService = ValidationService.getInstance()
      validator.validateConfig(configJson)
    } catch (validationError) {
      if (mode === 'lenient') {
        logger.warn('Config validation failed:', validationError)
        // Return the config anyway — caller will handle it
      } else {
        // required and optional modes throw on validation failure
        throw validationError
      }
    }
  }

  return configJson
}

export async function saveConfig(
  config: FirewallConfig,
  configPath?: string,
  options: ConfigSaveOptions = {},
): Promise<void> {
  // Destructured defaults rather than a default object literal: a caller
  // passing `{ throwOnError: false }` alone used to leave `validate`
  // undefined, silently skipping validation entirely instead of the
  // "validate but don't throw" it asked for.
  const { validate = true, throwOnError = true } = options

  const filePath = configPath || (await ConfigFinder.findConfig()) || ConfigFinder.getDefaultConfigPath()

  // Validate config before saving if requested
  if (validate) {
    try {
      const validator: ValidationService = ValidationService.getInstance()
      validator.validateConfig(config)
    } catch (validationError) {
      logger.error('Config validation failed:', validationError)
      if (throwOnError) {
        throw validationError
      }
    }
  }

  // Ensure directory exists
  const configDir = dirname(filePath)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  // Write atomically — temp file in the same directory, then rename (atomic
  // on POSIX within one filesystem).
  //
  // A truncated config is worse than no write at all here: `sync` saves this
  // file *after* mutating the remote firewall, so an interrupted plain write
  // (Ctrl+C, crash, disk full) would leave the live firewall changed and the
  // user's source of truth destroyed — the worst possible state to reconcile
  // from, for a tool whose whole premise is that this file *is* the config.
  const tempPath = `${filePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(config, null, 2))
    renameSync(tempPath, filePath)
  } catch (error) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath)
      }
    } catch {
      // Best-effort cleanup; surfacing the original write failure matters more
      // than a leftover temp file.
    }
    throw error
  }

  logger.debug(`Config saved to ${filePath}`)
}

/**
 * Resolve a mode string from either a ConfigLoadMode or legacy options object.
 */
function resolveMode(modeOrOptions: ConfigLoadMode | LegacyConfigOptions): ConfigLoadMode {
  if (typeof modeOrOptions === 'string') {
    return modeOrOptions
  }

  // Legacy options → mode mapping
  const { validate = true, throwOnError = true } = modeOrOptions
  if (!validate) return 'raw'
  if (!throwOnError) return 'lenient'
  return 'required'
}
