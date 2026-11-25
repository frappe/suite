import { afterEach, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { selectActions } from '@/apps/mail/utils/selectActions'
import { translationPlugin } from '@/platform/translation'

import MobileSelectionBar from './MobileSelectionBar.vue'

vi.mock('frappe-ui', () => ({ usePortalTarget: () => undefined, toast: {} }))
vi.mock('@/platform/feedback/AdaptiveDropdown.vue', () => ({ default: { render: () => null } }))

// The bar over a phone's list while selecting, with the actions a list's own folder offers.
const handlers = new Proxy({}, { get: () => () => {} })
const mount = (folder: { drafts: boolean }) => {
  const app = createApp(MobileSelectionBar, {
    open: true,
    count: 2,
    allSelected: false,
    actions: selectActions(
      () => [],
      () => ({ archive: false, trash: false, ...folder }),
      handlers,
    ),
  })
  app.use(translationPlugin)
  app.mount(document.createElement('div'))
  apps.push(app)
  return document.querySelector('[role="toolbar"]')!
}
const apps: ReturnType<typeof createApp>[] = []
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
})

it("says what Drafts' one action does in a word, where a bin alone would leave it to guess", () => {
  const bar = mount({ drafts: true })

  expect(bar.textContent).toContain('Discard')
})
