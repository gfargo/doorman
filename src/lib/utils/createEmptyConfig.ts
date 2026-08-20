import { SCHEMA_URL } from '../../constants/schema'
import { FirewallConfig } from '../types'

/**
 * Creates an empty firewall configuration object with default values.
 *
 * @param {Partial<FirewallConfig>} [args] - Optional partial configuration to override default values.
 * @returns {FirewallConfig} The generated firewall configuration object.
 */
export const createEmptyConfig = (args?: Partial<FirewallConfig>): FirewallConfig => ({
  $schema: SCHEMA_URL,
  firewallEnabled: true,
  rules: [],
  ips: [],
  ...args,
})
