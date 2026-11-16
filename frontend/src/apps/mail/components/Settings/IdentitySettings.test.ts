import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'

import IdentitySettings from './IdentitySettings.vue'

type IdentityRow = { name: string; id: string; email: string; _name: string; may_delete: 0 | 1 }

const state = vi.hoisted(() => ({
  identities: { data: [] as IdentityRow[] },
  runs: [] as { id: string; input: unknown }[],
  refuse: null as Error | null,
  confirmAnswer: true,
  confirmed: [] as string[],
  toasts: [] as string[],
}))

vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    Button: defineComponent({
      inheritAttrs: false,
      setup(_props, { attrs }) {
        return () => h('button', { onClick: attrs.onClick }, String(attrs.label ?? ''))
      },
    }),
  }
})
// A list row shows its title and one button per menu item, as the real menu lists them.
vi.mock('@/platform/settings-tab', async () => {
  const { defineComponent, h } = await import('vue')
  const slot = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('section', slots.default?.()),
  })
  return {
    SettingsPage: slot,
    SettingsSection: slot,
    SettingsLoading: slot,
    SettingsEmpty: defineComponent({
      props: { title: String },
      setup: (props) => () => h('p', props.title),
    }),
    SettingsListRow: defineComponent({
      props: { title: String, menu: Array },
      setup: (props) => () =>
        h('div', { 'data-row': props.title }, [
          props.title,
          ...((props.menu ?? []) as { label: string; onClick: () => void }[]).map((item) =>
            h('button', { onClick: item.onClick }, item.label),
          ),
        ]),
    }),
  }
})
vi.mock('@/platform/feedback', () => ({
  confirm: async (options: { title: string }) => {
    state.confirmed.push(options.title)
    return state.confirmAnswer
  },
  prompt: async () => null,
  toast: { success: (message: string) => state.toasts.push(message) },
}))
vi.mock('@/api', async () => {
  const { api } = await import('@/apps/mail/client/generated')
  return {
    api: { mail: api },
    useQuery: () => ({ data: [] }),
    useMutation: (reference: { id: string }) => ({
      isPending: false,
      run: async (input: unknown) => {
        state.runs.push({ id: reference.id, input })
        if (state.refuse) throw state.refuse
      },
    }),
  }
})
vi.mock('@/apps/mail/stores/user', () => ({
  userStore: () => ({ accountId: 'oa', identities: state.identities }),
}))
vi.mock('@/apps/mail/components/Settings/IdentityDialog.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/Modals/AddSignatureModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/Modals/EditSignatureModal.vue', () => ({
  default: { render: () => null },
}))

const primary: IdentityRow = {
  name: 'oa|a',
  id: 'a',
  email: 'me@example.com',
  _name: 'Me',
  may_delete: 0,
}
const alias: IdentityRow = {
  name: 'oa|b',
  id: 'b',
  email: 'sales@example.com',
  _name: '',
  may_delete: 1,
}

let app: ReturnType<typeof createApp> | null = null
function mount(identities: IdentityRow[]) {
  state.identities = reactive({ data: identities })
  const root = document.createElement('div')
  app = createApp(defineComponent({ render: () => h(IdentitySettings) }))
  app.config.globalProperties.__ = window.__
  app.mount(root)
  return root
}
const row = (root: HTMLElement, title: string) =>
  root.querySelector<HTMLElement>(`[data-row="${title}"]`)
const menuItem = (root: HTMLElement, title: string, label: string) =>
  [...(row(root, title)?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  window.__ = (message: string, replace?: string[]) =>
    replace ? message.replace(/\{(\d)\}/g, (_, i: string) => replace[Number(i)]) : message
  state.runs = []
  state.refuse = null
  state.confirmAnswer = true
  state.confirmed = []
  state.toasts = []
})
afterEach(() => app?.unmount())

describe('identities', () => {
  it('lists each identity by its name, or its address when it has none', () => {
    const root = mount([primary, alias])
    expect(row(root, 'Me')).not.toBeNull()
    expect(row(root, 'sales@example.com')).not.toBeNull()
  })

  it('offers Delete only when the server says the identity may be deleted', () => {
    const root = mount([primary, alias])
    expect(menuItem(root, 'Me', 'Delete')).toBeUndefined()
    expect(menuItem(root, 'sales@example.com', 'Delete')).toBeDefined()
  })

  it('asks first, then deletes the identity by name', async () => {
    const root = mount([primary, alias])
    menuItem(root, 'sales@example.com', 'Delete')!.click()
    await settle()
    expect(state.confirmed).toEqual(['Delete sales@example.com?'])
    expect(state.runs).toEqual([{ id: 'delete_identity_names', input: { names: ['oa|b'] } }])
    expect(state.toasts).toEqual(['Identity deleted'])
  })

  it('deletes nothing when the question is declined', async () => {
    state.confirmAnswer = false
    const root = mount([primary, alias])
    menuItem(root, 'sales@example.com', 'Delete')!.click()
    await settle()
    expect(state.runs).toEqual([])
  })

  it('reports no success when the server refuses the delete', async () => {
    state.refuse = new Error('Identity Deletion Error')
    const root = mount([primary, alias])
    menuItem(root, 'sales@example.com', 'Delete')!.click()
    await settle()
    expect(state.toasts).toEqual([])
    await nextTick()
    expect(row(root, 'sales@example.com')).not.toBeNull()
  })

  it('shows the empty state when there are no identities', () => {
    expect(mount([]).textContent).toContain('No identities yet')
  })
})
