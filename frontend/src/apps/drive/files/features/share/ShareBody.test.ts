import { fromAny } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, type PropType, type VNode } from 'vue'

import type { DriveGrant, GrantList } from '@/apps/drive/client/grants'
import { testClient } from '@/apps/drive/client/testClient'
import { toast } from '@/platform/feedback'
import type { Transport } from '@/platform/transport'
import { setTweaks } from '@/platform/tweaks'

import ShareBody from './ShareBody.vue'
import { useShare } from './useShare'

interface MenuItem {
  label: string
  onClick?: () => unknown
  slots?: { suffix?: () => VNode }
}

vi.mock('frappe-ui', async () => ({
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Avatar')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Button')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Checkbox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Combobox')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/DatePicker')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Dialog')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/ErrorMessage')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Password')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Select')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Skeleton')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/Switch')),
  ...(await import('../../../../../../../node_modules/frappe-ui/src/components/TextInput')),
  // The menu's items show beside its trigger, in order, so a test can read and choose them.
  Dropdown: defineComponent({
    props: {
      options: {
        type: Array as PropType<Array<MenuItem | { group: string; options: MenuItem[] }>>,
        default: () => [],
      },
    },
    setup:
      (props, { slots }) =>
      () =>
        h('div', [
          slots.default?.(),
          h(
            'menu',
            props.options
              .flatMap((item) => ('group' in item ? item.options : [item]))
              .map((item) =>
                h('button', { role: 'menuitem', onClick: item.onClick }, [
                  item.label,
                  item.slots?.suffix ? [' ', item.slots.suffix()] : null,
                ]),
              ),
          ),
        ]),
  }),
}))
vi.mock('@/platform/feedback', () => ({
  confirm: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const grant = (principal: string, role: number, extra: Partial<DriveGrant> = {}): DriveGrant => ({
  name: `g-${principal}`,
  node: 'doc',
  principal,
  role,
  expires_on: null,
  has_password: false,
  sent_to: null,
  ...extra,
})

/** A server holding the item's own grants; `inherited` is what its folders give. */
function server(inherited: GrantList['inherited'] = []) {
  const local = new Map<string, DriveGrant>()
  const writes: Array<{ id: string; principal: unknown; role?: unknown }> = []
  const transport: Transport = {
    request: async (operation, input) => {
      const { principal, role } = (input ?? {}) as { principal?: string; role?: number }
      if (operation.id === 'node_get')
        return fromAny({ kind: 'file', name: 'doc', title: 'Plan', access: { role: 50 } })
      if (operation.id === 'node_put_grant' && principal && typeof role === 'number') {
        writes.push({ id: operation.id, principal, role })
        const written = grant(principal === '$LINK' ? '$LINK:new' : principal, role, {
          url: principal === '$LINK' ? '/l/new' : undefined,
        })
        local.set(written.principal, written)
        return fromAny(written)
      }
      if (operation.id === 'node_delete_grant' && principal) {
        writes.push({ id: operation.id, principal })
        local.delete(principal)
        return fromAny({ count: 1 })
      }
      return fromAny({ grants: [...local.values()], inherited, owner: null })
    },
  }
  return { local, writes, transport }
}

async function mount(transport: Transport) {
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
  const row = (text: string) =>
    [...root.querySelectorAll('li')].find((item) => item.textContent?.includes(text))!
  const items = (text: string) =>
    [...row(text).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    )
  const choose = (text: string, label: string) =>
    [...row(text).querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim().startsWith(label))!
      .click()
  return { root, state, row, items, choose }
}

const publicFolder = {
  grant: grant('$PUBLIC', 10, { name: 'folder-public', node: 'folder' }),
  redacted: false,
  source_node: 'folder',
  source_title: 'Launch',
}

it('switches public access on and off here without writing a deny', async () => {
  const { local, writes, transport } = server()
  const { root, row } = await mount(transport)
  const toggle = () =>
    root.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Public on the web"]')!
  expect(row('Public on the web').textContent).toContain('Not public')

  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
  expect(row('Public on the web').textContent).toContain('Anyone on the internet can view')
  toggle().click()
  await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))

  expect(local.has('$PUBLIC')).toBe(false)
  expect(writes).toEqual([
    { id: 'node_put_grant', principal: '$PUBLIC', role: 10 },
    { id: 'node_delete_grant', principal: '$PUBLIC' },
  ])
  expect(row('Public on the web').textContent).toContain('Not public')
})

it('offers "Block public access here" on an item public through its folder, and Allow again undoes it', async () => {
  const { local, transport } = server([publicFolder])
  const { root, row, items, choose } = await mount(transport)
  expect(root.querySelector('[role="switch"]')).toBeNull()
  expect(row('Public on the web').textContent).toContain('via Launch')
  expect(items('Public on the web')).toEqual(['Block public access here'])

  choose('Public on the web', 'Block public access here')
  await vi.waitFor(() =>
    expect(row('Public on the web').textContent).toContain('Public access blocked here'),
  )
  expect(local.get('$PUBLIC')?.role).toBe(0)

  choose('Public on the web', 'Allow again')
  await vi.waitFor(() => expect(row('Public on the web').textContent).toContain('via Launch'))
  expect(local.has('$PUBLIC')).toBe(false)
})

it('changes the org access from one role menu, with a check on the current role and Remove last', async () => {
  const { local, transport } = server()
  const { row, items, choose } = await mount(transport)
  const org = 'Everyone in your organization'
  expect(items(org)).toEqual(['View', 'Comment', 'Edit'])

  choose(org, 'Comment')
  await vi.waitFor(() => expect(row(org).textContent).toContain('Can comment'))
  expect(local.get('$GENERAL')?.role).toBe(20)
  expect(items(org)).toEqual(['View', 'Comment Selected', 'Edit', 'Remove'])

  choose(org, 'Remove')
  await vi.waitFor(() => expect(row(org).textContent).toContain('Not shared'))
  expect(local.has('$GENERAL')).toBe(false)
})

it('makes a View link with no expiry from "New link", copies it and says so', async () => {
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const { writes, transport } = server()
  const { root, row } = await mount(transport)
  const button = [...root.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === 'New link',
  )!

  button.click()

  await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Link copied'))
  expect(writeText).toHaveBeenCalledWith(new URL('/l/new', window.location.origin).href)
  expect(writes).toEqual([{ id: 'node_put_grant', principal: '$LINK', role: 10 }])
  await vi.waitFor(() => expect(row('Anyone with this link').textContent).toContain('No expiry'))
})

it('with the access tweaks off, a switch off over a public folder blocks here and on again restores it', async () => {
  setTweaks(['t4-access-words', 't4-public-off'], false)
  try {
    const { local, transport } = server([publicFolder])
    const { root } = await mount(transport)
    const toggle = () =>
      root.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Everyone on the web"]')!
    expect(toggle().getAttribute('aria-checked')).toBe('true')
    toggle().click()
    await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('false'))
    expect(local.get('$PUBLIC')?.role).toBe(0)
    toggle().click()
    await vi.waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'))
    expect(local.has('$PUBLIC')).toBe(false)
  } finally {
    setTweaks(['t4-access-words', 't4-public-off'], true)
  }
})
