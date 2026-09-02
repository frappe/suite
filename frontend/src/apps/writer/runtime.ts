import { createResource } from 'frappe-ui'

import { allUsers } from '@/apps/drive/sdk'
import { getSessionUser } from '@/boot/session'

export function bootstrap() {
  if (getSessionUser()) allUsers.fetch()

  if (!window.translatedMessages) {
    createResource({
      url: 'suite.drive.api.product.get_translations',
      cache: 'translations',
      transform: (data: Record<string, string>) => (window.translatedMessages = data),
    }).fetch()
  }
}
