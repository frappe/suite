import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import { testClient } from '@/apps/drive/client/testClient'
import type { Transport } from '@/platform/transport'

import ShareLinkDialog from './ShareLinkDialog.vue'
import { useShare } from './useShare'

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/DatePicker')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Password')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Select')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Switch')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/TextInput')),
}))

vi.mock('@/platform/feedback', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})

function mountDialog() {
  const writes: unknown[] = []
  const transport: Transport = {
    request: async (operation, input) => {
      if (operation.id === 'node_put_grant') {
        writes.push(input)
        return { url: '/l/test-link' } as never
      }
      if (operation.id === 'node_get') return { kind: 'file', access: { role: 50 } } as never
      return { grants: [], inherited: [], owner: null } as never
    },
  }
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    setup() {
      const state = useShare('doc', { client: testClient(transport) })
      return () => h(ShareLinkDialog, { open: true, nodeKind: 'file', state })
    },
  })
  app.mount(root)
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  return writes
}

function submit() {
  document
    .querySelector('#create-share-link')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

describe('Share link options', () => {
  it('defaults to one calendar month, clamping month-end, with password protection off', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2027, 0, 31, 12))
    const writes = mountDialog()
    await nextTick()
    const date = document.querySelector<HTMLInputElement>('input[placeholder="No expiry date"]')!
    expect(date.value).toBe('2027-02-28')
    expect(document.querySelector('input[type="password"]')).toBeNull()

    submit()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      node: 'doc',
      principal: '$LINK',
      role: 10,
      expires_on: new Date(2027, 1, 28, 23, 59, 59).toISOString().replace('.000Z', 'Z'),
      password: null,
    })
    await vi.waitFor(() => expect(document.body.textContent).toContain('Your share link is ready.'))
  })

  it('can remove expiry and enable password protection, discarding the password when switched off', async () => {
    const writes = mountDialog()
    await nextTick()
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    expect(document.querySelector('input[type="password"]')).toBeNull()
    toggle.click()
    await nextTick()
    const password = document.querySelector<HTMLInputElement>('input[type="password"]')!
    expect(password.disabled).toBe(false)
    password.value = 'secret-password'
    password.dispatchEvent(new Event('input', { bubbles: true }))
    toggle.click()
    await nextTick()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    toggle.click()
    await nextTick()
    expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('')
    toggle.click()
    await nextTick()

    document.querySelector<HTMLInputElement>('input[placeholder="No expiry date"]')!.click()
    await vi.waitFor(() => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
        (button) => button.textContent?.trim() === 'No expiry date',
      )
      expect(button).toBeDefined()
      button!.click()
    })
    await nextTick()
    expect(
      document.querySelector<HTMLInputElement>('input[placeholder="No expiry date"]')!.value,
    ).toBe('')
    submit()
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0]).toEqual({
      node: 'doc',
      principal: '$LINK',
      role: 10,
      expires_on: null,
      password: null,
    })
  })
})
