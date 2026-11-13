import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import AppSidebar from '@/apps/mail/components/AppSidebar.vue'

// What the server holds, and how its list answers the two ways of asking: every pending
// submission, or only the ones waiting to be pointed out.
const held = vi.hoisted(() => ({ undoHolds: 0, goingOut: 0, stuck: 0, scheduled: 0 }))

vi.mock('@/api', async (importOriginal) => {
  const { shallowReactive } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@/api')>()),
    useQuery: (_query: unknown, input: () => Record<string, unknown> | false) => {
      const answer = () => {
        const asked = input()
        const waiting = held.stuck + held.scheduled
        return (
          asked && {
            total: asked.waiting_only ? waiting : waiting + held.undoHolds + held.goingOut,
          }
        )
      }
      const query = shallowReactive({
        data: answer(),
        refetch: async () => {
          query.data = answer()
        },
      })
      return query
    },
  }
})
// A row is its label and its count; what wraps the rows is not under test.
vi.mock('frappe-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passThrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return {
    toast: {},
    Button: passThrough,
    Dropdown: defineComponent({ setup: () => () => null }),
    Tooltip: passThrough,
    SidebarSection: passThrough,
    SidebarItem: defineComponent({
      props: { label: String, onClick: Function },
      setup:
        (props, { slots }) =>
        () =>
          h('button', { 'data-row': props.label, onClick: props.onClick }, slots.suffix?.()),
    }),
  }
})
vi.mock('@/platform/area-sidebar', async () => {
  const { defineComponent, h } = await import('vue')
  const passThrough = defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  })
  return { AreaSidebar: passThrough, AreaSidebarFooter: passThrough, accountSubmenu: () => [] }
})
vi.mock('@/apps/mail/components/Modals/DeleteFolderModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/Modals/FolderModal.vue', () => ({
  default: { render: () => null },
}))
vi.mock('@/apps/mail/components/QuotaBar.vue', () => ({ default: { render: () => null } }))
vi.mock('@/apps/mail/composables/useThreadDrag', async () => {
  const { ref } = await import('vue')
  return {
    useThreadDrag: () => ({ isDragging: ref(false), overMailbox: ref(''), filedIn: ref([]) }),
  }
})
vi.mock('@/apps/mail/utils/composables', async () => {
  const { ref } = await import('vue')
  return {
    useAccountSwitch: () => ({ switchAccount: () => {}, switchToAll: () => {} }),
    useScreenSize: () => ({ isMobile: ref(false) }),
  }
})
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ name: 'mail-mailbox', params: { mailbox: 'inbox' }, meta: {} }),
  useRouter: () => ({ push: () => {} }),
}))
vi.mock('@/apps/mail/stores/user', async (importOriginal) => {
  const folder = (id: string, name: string, role: string) => ({
    id,
    name,
    role,
    subscribed: true,
    unread_threads: 0,
  })
  return {
    ...(await importOriginal<typeof import('@/apps/mail/stores/user')>()),
    userStore: () => ({
      accountId: 'acc',
      mailboxIds: {},
      mailboxes: {
        data: [
          folder('m1', 'Inbox', 'inbox'),
          folder('m2', 'Sent', 'sent'),
          folder('m3', 'Archive', 'archive'),
          folder('m4', 'Trash', 'trash'),
        ],
      },
      unifiedFolders: { data: [] },
      userResource: { data: { accounts: [], is_jmap_configured: true } },
    }),
  }
})
vi.stubGlobal('__', (text: string) => text)

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
})
beforeEach(() => {
  localStorage.clear()
  Object.assign(held, { undoHolds: 0, goingOut: 0, stuck: 0, scheduled: 0 })
})

async function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const app = createApp({ setup: () => () => h(AppSidebar) })
  app.config.globalProperties.__ = (text: string) => text
  app.mount(root)
  await nextTick()
  cleanup = () => {
    app.unmount()
    root.remove()
  }
  const row = (label: string) => root.querySelector<HTMLElement>(`[data-row="${label}"]`)
  const labels = () =>
    [...root.querySelectorAll<HTMLElement>('[data-row]')].map((item) => item.dataset.row)
  const openMore = async () => {
    row('More')!.click()
    await nextTick()
  }
  return { row, labels, openMore }
}

describe('where the sidebar puts Outbox', () => {
  it.each([
    ['held for Undo send', 'undoHolds'],
    ['going out straight away', 'goingOut'],
  ] as const)('leaves it under More while a mail is only %s', async (_state, kind) => {
    held[kind] = 1

    const sidebar = await mount()
    expect(sidebar.row('Outbox')).toBeNull()

    await sidebar.openMore()
    const labels = sidebar.labels()
    expect(labels.indexOf('Outbox')).toBeGreaterThan(labels.indexOf('More'))
    expect(sidebar.row('Outbox')!.textContent).toBe('')
  })

  it('leads with it and counts only the scheduled sends', async () => {
    held.undoHolds = 1
    held.scheduled = 2

    const sidebar = await mount()
    const labels = sidebar.labels()
    expect(labels).toContain('Outbox')
    expect(labels.indexOf('Outbox')).toBeLessThan(labels.indexOf('More'))
    expect(sidebar.row('Outbox')!.textContent).toBe('2')
  })

  it('leads with it while a released mail is stuck retrying', async () => {
    held.goingOut = 1
    held.stuck = 1

    const sidebar = await mount()
    const labels = sidebar.labels()
    expect(labels.indexOf('Outbox')).toBeLessThan(labels.indexOf('More'))
    expect(sidebar.row('Outbox')!.textContent).toBe('1')
  })

  it('brings it out when a mail gets stuck after the sidebar had nothing waiting', async () => {
    vi.useFakeTimers()
    held.goingOut = 1
    const sidebar = await mount()
    expect(sidebar.row('Outbox')).toBeNull()

    held.goingOut = 0
    held.stuck = 1
    await vi.advanceTimersByTimeAsync(120_000)
    expect(sidebar.row('Outbox')!.textContent).toBe('1')
  })
})
