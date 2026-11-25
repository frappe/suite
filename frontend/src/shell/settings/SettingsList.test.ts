import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, ref } from 'vue'

import type { VisibleSettingsGroup } from '@/shell/settings/settings'
import SettingsList from '@/shell/settings/SettingsList.vue'

vi.mock('@/platform/session', () => ({
  useSession: () => ({ user: ref({ fullName: 'Ada', avatar: null }) }),
}))

const body = async () => ({})
const tab = (id: string) => ({ id, label: () => id, icon: 'lucide-circle', body })
const groups: VisibleSettingsGroup[] = [
  { label: 'Account', tabs: [tab('account.preferences')] },
  { label: 'Mail', tabs: [tab('mail.general'), tab('mail.inbox')] },
]

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function show(flat: boolean) {
  const root = document.body.appendChild(document.createElement('div'))
  const app = createApp({ setup: () => () => h(SettingsList, { groups, flat }) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return {
    cards: root.querySelectorAll('section').length,
    text: root.textContent ?? '',
    rows: [...root.querySelectorAll('button')].map((row) => row.textContent?.trim()),
  }
}

it('heads a card for each group', () => {
  const list = show(false)
  expect(list.cards).toBe(2)
  expect(list.text).toContain('Account')
  expect(list.text).toContain('Mail')
})

it('lays every row in one card with no headings when flat, in the same order', () => {
  const list = show(true)
  expect(list.cards).toBe(1)
  expect(list.rows).toEqual(['account.preferences', 'mail.general', 'mail.inbox'])
  expect(list.text).not.toContain('Account')
  expect(list.text).not.toContain('Mail')
})
