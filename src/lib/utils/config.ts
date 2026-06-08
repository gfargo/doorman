import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
  options: ConfigSaveOptions = { validate: true, throwOnError: true },
): Promise<void> {
  const filePath = configPath || (await ConfigFinder.findConfig()) || ConfigFinder.getDefaultConfigPath()

  // Validate config before saving if requested
  if (options.validate) {
    try {
      const validator: ValidationService = ValidationService.getInstance()
      validator.validateConfig(config)
    } catch (validationError) {
      logger.error('Config validation failed:', validationError)
      if (options.throwOnError) {
        throw validationError
      }
    }
  }

  // Ensure directory exists
  const configDir = dirname(filePath)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }

  writeFileSync(filePath, JSON.stringify(config, null, 2))
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
