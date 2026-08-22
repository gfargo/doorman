import { Template } from '../types'

export const wordpress: Template = {
  metadata: {
    title: 'Deny Common WordPress URLs Firewall Rule',
    reference: 'https://vercel.com/templates/other/block-wordpress-urls-firewall-rule',
  },
  config: {
    rules: [
      {
        id: 'rule_deny_word_press_ur_ls',
        name: 'Deny WordPress URLs',
        description: '',
        conditionGroup: [
          {
            conditions: [
              {
                type: 'path',
                op: 're',
                value:
                  '/(wp-admin|wp-login\\.php|xmlrpc\\.php|wp-content|wp-includes|wp-signup\\.php|wp-activate\\.php|register\\.php|wp-register\\.php)',
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
  },
}
