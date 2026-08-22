import chalk from 'chalk'
import { IPBlockingRule } from '../../types'

/**
 * Formats an IP blocking rule object for display in a table.
 *
 * @param rule - The IP blocking rule object, which includes an optional change status.
 * @returns An object containing the formatted IP blocking rule properties:
 * - `id`: The rule's ID or '-' if not provided.
 * - `ip`: The IP address associated with the rule.
 * - `hostname`: The hostname associated with the rule.
 * - `notes`: Any notes associated with the rule or '-' if not provided.
 * - `status`: The change status formatted in yellow if provided, otherwise 'deny' in red.
 */
export function formatIPBlockingRule(rule: IPBlockingRule & { changeStatus?: string }) {
  return {
    id: rule.id || '-',
    ip: rule.ip,
    hostname: rule.hostname || '-',
    notes: rule.notes || '-',
    status: rule.changeStatus ? chalk.yellow(rule.changeStatus) : chalk.red('deny'),
  }
}
