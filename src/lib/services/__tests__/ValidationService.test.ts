import { FirewallConfig } from '../../types'
import { ValidationError, ValidationService } from '../ValidationService'

describe('ValidationService', () => {
  let validator: ValidationService

  beforeEach(() => {
    validator = ValidationService.getInstance()
  })

  describe('action validation', () => {
    it('should validate basic Vercel action structure', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny',
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).not.toThrow()
    })

    it('should validate full Vercel action structure with rate limiting', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny',
                rateLimit: {
                  requests: 100,
                  window: '1m',
                },
                actionDuration: '1h',
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).not.toThrow()
    })

    it('should reject invalid action type', () => {
      const config = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'invalid-action',
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).toThrow(ValidationError)
    })

    it('should validate rate limit configuration', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'rate_limit',
                rateLimit: {
                  requests: -1, // Invalid negative value
                  window: '1m',
                },
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).toThrow(ValidationError)
    })

    it('should validate action duration format', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny',
                actionDuration: 'invalid', // Invalid duration format
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).toThrow(ValidationError)
    })

    it('should validate redirect configuration', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'redirect',
                // @ts-expect-error Testing invalid redirect configuration
                redirect: {
                  permanent: true,
                  // Missing required location field
                },
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).toThrow(ValidationError)
    })

    it('should validate complex action configuration', () => {
      const config: FirewallConfig = {
        rules: [
          {
            name: 'test-rule',
            conditionGroup: [
              {
                conditions: [
                  {
                    type: 'path',
                    op: 'pre',
                    value: '/api',
                  },
                ],
              },
            ],
            action: {
              mitigate: {
                action: 'deny',
                rateLimit: {
                  requests: 100,
                  window: '1m',
                },
                redirect: {
                  location: '/error',
                  permanent: true,
                },
                actionDuration: '1h',
              },
            },
            active: true,
          },
        ],
      }

      expect(() => validator.validateConfig(config)).not.toThrow()
    })
  })

  describe('IP address condition validation (regression tests for #95)', () => {
    const configWithIP = (value: string): FirewallConfig => ({
      rules: [
        {
          name: 'test-rule',
          conditionGroup: [
            {
              conditions: [
                {
                  type: 'ip_address',
                  op: 'eq',
                  value,
                },
              ],
            },
          ],
          action: {
            mitigate: {
              action: 'deny',
            },
          },
          active: true,
        },
      ],
    })

    it.each(['::1', '2001:db8::1', 'fe80::1ff:fe23:4567:890a', '::', '2001:db8::/32'])(
      'accepts the compressed IPv6 form %s',
      (value) => {
        expect(() => validator.validateConfig(configWithIP(value))).not.toThrow()
      },
    )

    it('still accepts a plain IPv4 address', () => {
      expect(() => validator.validateConfig(configWithIP('192.168.1.1'))).not.toThrow()
    })

    it('still accepts an IPv4 CIDR range', () => {
      expect(() => validator.validateConfig(configWithIP('10.0.0.0/8'))).not.toThrow()
    })

    it('still rejects a malformed address', () => {
      expect(() => validator.validateConfig(configWithIP('not-an-ip'))).toThrow(ValidationError)
    })
  })
})
