import { describe, it, expect } from '@jest/globals'
import { DoormanError } from '../DoormanError'
import { ConfigErrorCode, ProviderErrorCode, CloudflareErrorCode } from '../ErrorCodes'

describe('DoormanError', () => {
  describe('Constructor', () => {
    it('should create error with code and message', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      expect(error.code).toBe(ConfigErrorCode.NOT_FOUND)
      expect(error.message).toBe('Configuration file not found')
      expect(error.name).toBe('DoormanError')
    })

    it('should create error with suggestion', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        suggestion: 'Run doorman init to create a new config',
      })

      expect(error.suggestion).toBe('Run doorman init to create a new config')
    })

    it('should create error with details', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        details: {
          path: '/path/to/config.json',
          exists: false,
        },
      })

      expect(error.details).toEqual({
        path: '/path/to/config.json',
        exists: false,
      })
    })

    it('should create error with cause', () => {
      const cause = new Error('Original error')
      const error = new DoormanError({
        code: ConfigErrorCode.PARSE_ERROR,
        message: 'Failed to parse config',
        cause,
      })

      expect(error.cause).toBe(cause)
    })

    it('should create error with docs URL', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        docsUrl: 'https://docs.example.com/errors/CONFIG_1001',
      })

      expect(error.docsUrl).toBe('https://docs.example.com/errors/CONFIG_1001')
    })
  })

  describe('format()', () => {
    it('should format basic error message', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      const formatted = error.format()
      expect(formatted).toContain('[CONFIG_1001]')
      expect(formatted).toContain('Configuration file not found')
    })

    it('should include suggestion in formatted output', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        suggestion: 'Run doorman init',
      })

      const formatted = error.format()
      expect(formatted).toContain('Suggestion:')
      expect(formatted).toContain('Run doorman init')
    })

    it('should include details in formatted output', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        details: {
          path: '/path/to/config.json',
        },
      })

      const formatted = error.format()
      expect(formatted).toContain('Details:')
      expect(formatted).toContain('path')
      expect(formatted).toContain('/path/to/config.json')
    })

    it('should include cause in formatted output', () => {
      const cause = new Error('Original error')
      const error = new DoormanError({
        code: ConfigErrorCode.PARSE_ERROR,
        message: 'Failed to parse config',
        cause,
      })

      const formatted = error.format()
      expect(formatted).toContain('Caused by:')
      expect(formatted).toContain('Original error')
    })

    it('should include docs URL in formatted output', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        docsUrl: 'https://docs.example.com/errors/CONFIG_1001',
      })

      const formatted = error.format()
      expect(formatted).toContain('Documentation:')
      expect(formatted).toContain('https://docs.example.com/errors/CONFIG_1001')
    })
  })

  describe('toPlainText()', () => {
    it('should format error without colors', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
        suggestion: 'Run doorman init',
        details: {
          path: '/path/to/config.json',
        },
        docsUrl: 'https://docs.example.com/errors/CONFIG_1001',
      })

      const plainText = error.toPlainText()
      expect(plainText).toContain('[CONFIG_1001]')
      expect(plainText).toContain('Configuration file not found')
      expect(plainText).toContain('Suggestion: Run doorman init')
      expect(plainText).toContain('path: /path/to/config.json')
      expect(plainText).toContain('Documentation: https://docs.example.com/errors/CONFIG_1001')
      // Should not contain ANSI color codes (no ESC trigger)
      expect(plainText).not.toContain('\u001b[')
    })
  })

  describe('isDoormanError()', () => {
    it('should return true for DoormanError instances', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      expect(DoormanError.isDoormanError(error)).toBe(true)
    })

    it('should return false for regular Error instances', () => {
      const error = new Error('Regular error')

      expect(DoormanError.isDoormanError(error)).toBe(false)
    })

    it('should return false for non-error values', () => {
      expect(DoormanError.isDoormanError('string')).toBe(false)
      expect(DoormanError.isDoormanError(null)).toBe(false)
      expect(DoormanError.isDoormanError(undefined)).toBe(false)
      expect(DoormanError.isDoormanError({})).toBe(false)
    })
  })

  describe('from()', () => {
    it('should return DoormanError as-is', () => {
      const original = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      const converted = DoormanError.from(original, ProviderErrorCode.API_ERROR)

      expect(converted).toBe(original)
    })

    it('should convert regular Error to DoormanError', () => {
      const original = new Error('Original error')
      const converted = DoormanError.from(original, ProviderErrorCode.API_ERROR)

      expect(converted).toBeInstanceOf(DoormanError)
      expect(converted.code).toBe(ProviderErrorCode.API_ERROR)
      expect(converted.message).toBe('Original error')
      expect(converted.cause).toBe(original)
    })

    it('should convert regular Error with custom message', () => {
      const original = new Error('Original error')
      const converted = DoormanError.from(original, ProviderErrorCode.API_ERROR, 'Custom message')

      expect(converted.message).toBe('Custom message')
      expect(converted.cause).toBe(original)
    })

    it('should convert non-Error values to DoormanError', () => {
      const converted = DoormanError.from('String error', CloudflareErrorCode.INVALID_IP)

      expect(converted).toBeInstanceOf(DoormanError)
      expect(converted.code).toBe(CloudflareErrorCode.INVALID_IP)
      expect(converted.message).toBe('String error')
    })
  })

  describe('Error inheritance', () => {
    it('should be instanceof Error', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct prototype chain', () => {
      const error = new DoormanError({
        code: ConfigErrorCode.NOT_FOUND,
        message: 'Configuration file not found',
      })

      expect(Object.getPrototypeOf(error)).toBe(DoormanError.prototype)
      expect(Object.getPrototypeOf(DoormanError.prototype)).toBe(Error.prototype)
    })

    it('should be catchable like a regular Error', () => {
      try {
        throw new DoormanError({
          code: ConfigErrorCode.NOT_FOUND,
          message: 'Configuration file not found',
        })
      } catch (error) {
        expect(error).toBeInstanceOf(DoormanError)
        expect(error).toBeInstanceOf(Error)
      }
    })
  })
})
