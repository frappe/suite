import type { RouteLocationNormalized } from 'vue-router'
import { createResource } from 'frappe-ui'

import { setActiveEntity } from '@/apps/drive/data/selection'
import { setupTheme } from '@/utils/setupTheme'

export function bootstrap() {
  setupTheme()

  if (!window.translatedMessages) {
    createResource({
      url: 'suite.drive.api.product.get_translations',
      cache: 'translations',
      transform: (data: unknown) => (window.translatedMessages = data),
    }).fetch()
  }
}

export const beforeEach = (_to: RouteLocationNormalized) => {
  setActiveEntity(null)
}

export function afterEach(to: { fullPath: string }) {
  sessionStorage.setItem('currentRoute', to.fullPath)
}
