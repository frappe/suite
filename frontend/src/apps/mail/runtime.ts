import { createResource } from 'frappe-ui'

import { mailGuard } from '@/apps/mail/router'
import { settleOpenMailbox } from '@/apps/mail/utils/locations'

export function bootstrap() {
  if (!window.translatedMessages) {
    createResource({
      url: 'suite.mail.api.get_translations',
      cache: 'translations',
      transform: (data) => (window.translatedMessages = data),
    }).fetch()
  }
}

export const beforeEach = mailGuard
export const afterEach = settleOpenMailbox
