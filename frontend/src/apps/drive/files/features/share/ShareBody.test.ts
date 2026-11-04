import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h } from 'vue'

import type { DriveGrant } from '@/apps/drive/client/grants'
import { testClient } from '@/apps/drive/client/testClient'
import type { Transport } from '@/platform/transport'

import ShareBody from './ShareBody.vue'
import { useShare } from './useShare'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Combobox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/DatePicker')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dropdown')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Password')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Select')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Switch')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/TextInput')),
}))
vi.mock('@/platform/feedback', () => ({
  confirm: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

it('restores inherited public access so unpublishing the ancestor also unpublishes this item', async () => {
  let ancestorPublished = true
  let local: DriveGrant | undefined
  const publicGrant: DriveGrant = {
    name: 'ancestor-public',
    node: 'folder',
    principal: '$PUBLIC',
    role: 10,
    expires_on: null,
    has_password: false,
    sent_to: null,
  }
  const transport: Transport = {
    request: async (operation, input) => {
      if (operation.id === 'node_get')
        return { kind: 'file', name: 'doc', access: { role: 50 } } as never
      if (operation.id === 'node_put_grant') {
        const { role } = input as { role: number }
        local = { ...publicGrant, name: 'local-public', node: 'doc', role }
        return local as never
      }
      if (operation.id === 'node_delete_grant') {
        local = undefined
        return { count: 1 } as never
      }
      return {
        grants: local ? [local] : [],
        inherited: ancestorPublished
          ? [{ grant: publicGrant, redacted: false, source_node: 'folder', source_title: 'Launch' }]
          : [],
        owner: null,
      } as never
    },
  }
  const state = useShare('doc', { client: testClient(transport) })
  await state.load()
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ setup: () => () => h(ShareBody, { state }) })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const toggle = () =>
    root.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Everyone on the web"]')!
  expect(toggle().getAttribute('aria-checked')).toBe('true')
  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  expect(local).toBeUndefined()
  expect(state.sections.value?.public).toMatchObject({ state: 'inherited' })

  ancestorPublished = false
  await state.load()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
  expect(state.sections.value?.public).toEqual({ state: 'off' })

  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  expect(local).toMatchObject({ node: 'doc', principal: '$PUBLIC', role: 10 })
  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  expect(local).toMatchObject({ node: 'doc', principal: '$PUBLIC', role: 10 })
})
