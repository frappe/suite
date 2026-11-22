import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import { listScope, useClearList } from './useClearList'
import { useInboxTabs, useTabChoice, useTabChoiceMenu, type InboxCategory } from './useInboxTabs'

type Counts = { category: InboxCategory; unread_threads: number }[]

const { fromPartial } = await vi.hoisted(() => import('@total-typescript/shoehorn'))

type InboxTabsStore = {
  inboxTabs: InboxCategory[]
  tabCounts: { data: Counts | null }
  unifiedTabCounts: { data: Counts | null }
  mailboxIds: { inbox?: string }
  mailboxes: { data: { id: string; unread_threads: number }[] | null }
  unifiedFolders: { data: { slug: string; unread_threads: number }[] | null }
  userResource: {
    data: {
      email_classification: boolean
      split_inbox: 0 | 1
      inbox_tabs: InboxCategory[]
      all_mail_tab: 0 | 1
    }
  }
}

const state = vi.hoisted(() => ({
  route: fromPartial<{ query: Record<string, string> }>({ query: {} }),
  store: fromPartial<InboxTabsStore>({}),
}))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('@/apps/mail/stores/user', () => ({ userStore: () => state.store }))
const saved = vi.hoisted(() => fromPartial<unknown[]>([]))
const toasts = vi.hoisted(() => fromPartial<string[]>([]))
// Saves resolve at once, unless a test holds them to see what happens while they are pending.
const held = vi.hoisted(() => ({ on: false, release: fromPartial<(() => void)[]>([]) }))
// What the server answers a clearing with: what it changed, by account.
const answers = vi.hoisted(() => new Map<unknown, unknown>())
const routes = vi.hoisted(() => ({
  updatePreferences: { name: 'updatePreferences' },
  clearList: { name: 'clearList' },
  seen: { name: 'seen' },
  setFolders: { name: 'setFolders' },
}))
vi.mock('@/api', () => ({
  api: {
    mail: {
      settings: { updatePreferences: routes.updatePreferences },
      messages: routes,
    },
  },
  client: {
    mutation: async (reference: unknown, input: unknown) => {
      saved.push(input)
      if (held.on) await new Promise<void>((resolve) => held.release.push(resolve))
      return answers.get(reference)
    },
  },
}))
vi.mock('@/apps/mail/utils', () => ({
  raiseToast: (message: string) => toasts.push(message),
  raiseOptimisticToast: async (
    done: Promise<unknown>,
    timing: { onClick: string } | { onAnswer: string | ((result: unknown) => string) },
  ) => {
    const result = await done
    const message = 'onClick' in timing ? timing.onClick : timing.onAnswer
    toasts.push(typeof message === 'string' ? message : message(result))
  },
}))
// Mail's one undo slot, as the toast's Undo and Cmd/Ctrl+Z both reach it.
const undoSlot = vi.hoisted(() => ({ action: fromPartial<(() => unknown) | undefined>(undefined) }))
vi.mock('@/apps/mail/utils/composables', () => ({
  useSettings: () => ({ openSettings: () => {} }),
  useUndo: () => ({
    setUndoAction: (action?: () => unknown) => (undoSlot.action = action),
    undo: () => undoSlot.action?.(),
  }),
}))

const INBOX = { name: 'mail-mailbox', params: { accountId: 'ih', mailbox: 'inbox' } }

const tabsFor = (scope: 'account' | 'unified' | false) =>
  useInboxTabs(
    () => scope,
    () => INBOX,
  )

describe('the Inbox tabs', () => {
  beforeEach(() => {
    vi.stubGlobal('__', (text: string, args: string[] = []) =>
      text.replace(/\{(\d+)\}/g, (_, index) => args[Number(index)]),
    )
    answers.clear()
    undoSlot.action = undefined
    state.route = reactive({ query: {} })
    saved.length = 0
    toasts.length = 0
    localStorage.clear()
    state.store = reactive({
      userResource: {
        data: {
          email_classification: true,
          split_inbox: 1,
          inbox_tabs: ['primary', 'updates', 'forums', 'promotions'],
          all_mail_tab: 1,
        },
      },
      inboxTabs: ['primary', 'updates', 'forums', 'promotions'],
      tabCounts: {
        data: [
          { category: 'primary', unread_threads: 12 },
          { category: 'updates', unread_threads: 79 },
          { category: 'forums', unread_threads: 0 },
          { category: 'promotions', unread_threads: 2 },
        ],
      },
      unifiedTabCounts: { data: [{ category: 'updates', unread_threads: 90 }] },
      // A thread can hold mail of more than one category, so the Inbox's own count is not the sum of
      // its tabs'.
      mailboxIds: { inbox: 'i1' },
      mailboxes: {
        data: [
          { id: 'a1', unread_threads: 4 },
          { id: 'i1', unread_threads: 88 },
        ],
      },
      unifiedFolders: {
        data: [
          { slug: 'archive', unread_threads: 5 },
          { slug: 'inbox', unread_threads: 140 },
        ],
      },
    })
  })

  it('are the categories the server splits the Inbox into, in its order, with their unread, then All mail', () => {
    const { tabs } = tabsFor('account')

    expect(tabs.value.map((tab) => [tab.label, tab.unread])).toEqual([
      ['Primary', 12],
      ['Updates', 79],
      ['Forums', 0],
      ['Promotions', 2],
      // The whole Inbox, as the sidebar counts it.
      ['All mail', 88],
    ])
  })

  it('count every account at once in All accounts', () => {
    const { tabs } = tabsFor('unified')

    expect(tabs.value.find((tab) => tab.id === 'updates')?.unread).toBe(90)
    expect(tabs.value.find((tab) => tab.id === 'primary')?.unread).toBe(0)
    expect(tabs.value.find((tab) => tab.id === 'all')?.unread).toBe(140)
  })

  it('ask for the open category, and for none in All mail, the whole Inbox', () => {
    const { active, category } = tabsFor('account')
    expect([active.value, category.value]).toEqual(['primary', 'primary'])

    state.route.query = { category: 'updates' }
    expect([active.value, category.value]).toEqual(['updates', 'updates'])

    state.route.query = { category: 'all' }
    expect([active.value, category.value]).toEqual(['all', undefined])
  })

  it('refetch the list when All mail opens, as any other tab does', async () => {
    let switches = 0
    useInboxTabs(
      () => 'account',
      () => INBOX,
      () => switches++,
    )

    state.route.query = { category: 'all' }
    await nextTick()
    state.route.query = { category: 'primary' }
    await nextTick()

    expect(switches).toBe(2)
  })

  it('clear All mail as the whole Inbox: marked read, never archived or trashed in one go', async () => {
    state.route.query = { category: 'all' }
    const { category } = tabsFor('account')
    const { menuFor, clear } = useClearList(() => ({ account: 'ih', mailbox: 'inbox' }))
    const scope = listScope(category.value, 'Inbox', null)

    expect(menuFor(scope).flatMap((group) => group.options.map((option) => option.label))).toEqual([
      'Mark all as read',
    ])
    answers.set(routes.clearList, { cleared: [{ account: 'ih', ids: ['a'] }], failed: [] })
    await clear('read', scope)
    expect(saved).toContainEqual({
      action: 'read',
      account: 'ih',
      mailbox: 'inbox',
      category: undefined,
      filter_by: null,
    })
    expect(toasts).toEqual(['Inbox mail marked as read'])
  })

  it('open the tab the route names, and Primary the first time it names none', () => {
    const { active } = tabsFor('account')
    expect(active.value).toBe('primary')

    state.route.query = { category: 'forums' }
    expect(active.value).toBe('forums')

    state.route.query = { category: 'all' }
    expect(active.value).toBe('all')
  })

  it('reopen the tab last opened when the route names none, in this list or All accounts', async () => {
    state.route.query = { category: 'all' }
    tabsFor('account')
    await nextTick()

    // Back to the Inbox later, by a link that names no tab (the sidebar's, say).
    state.route.query = {}
    expect(tabsFor('account').active.value).toBe('all')
    expect(tabsFor('unified').active.value).toBe('all')

    // A link that names a tab still opens it, and is the one remembered next.
    state.route.query = { category: 'updates' }
    tabsFor('account')
    await nextTick()
    state.route.query = {}
    expect(tabsFor('account').active.value).toBe('updates')
  })

  it('open Primary when the tab last opened has none now', async () => {
    state.route.query = { category: 'all' }
    tabsFor('account')
    await nextTick()

    state.store.userResource.data.all_mail_tab = 0
    state.route.query = {}
    expect(tabsFor('account').active.value).toBe('primary')

    // Nor does a link to a tab that isn't there open an empty list.
    state.route.query = { category: 'social' }
    expect(tabsFor('account').active.value).toBe('primary')
  })

  it('end with All mail only while it is on', () => {
    state.store.userResource.data.all_mail_tab = 0
    const { tabs, active } = tabsFor('account')
    expect(tabs.value.map((tab) => tab.id)).toEqual(['primary', 'updates', 'forums', 'promotions'])

    state.route.query = { category: 'all' }
    expect(active.value).toBe('primary')
  })

  it('offer their switches in one Tabs submenu, under Categories, only while it is on', () => {
    const { rows } = useTabChoiceMenu()
    expect(rows.value.map((row) => row.label)).toEqual(['Categories', 'Tabs'])

    state.store.userResource.data.split_inbox = 0
    expect(rows.value.map((row) => row.label)).toEqual(['Categories'])

    // Nothing to choose where the site doesn't sort mail into categories.
    state.store.userResource.data.email_classification = false
    expect(rows.value).toEqual([])
  })

  it('turn All mail on and off from the Tabs submenu, after the categories', async () => {
    const { rows } = useTabChoiceMenu()
    const options = rows.value.flatMap((row) => ('submenu' in row ? row.submenu : []))
    expect(options.map((option) => [option.label, option.switchValue])).toEqual([
      ['Updates', true],
      ['Forums', true],
      ['Promotions', true],
      ['Social', false],
      ['All mail', true],
    ])

    // Not held on like the last category: without it the categories are still there.
    expect(options.at(-1)?.disabled).toBe(false)
    options.at(-1)?.onClick(false)
    await nextTick()
    expect(saved).toEqual([{ all_mail_tab: 0 }])
  })

  it('are absent from any other list, and from an Inbox that is not split', () => {
    expect(tabsFor(false).tabs.value).toEqual([])
    expect(tabsFor(false).active.value).toBeUndefined()

    // Nor is there an All mail tab, alone over the list it already is.
    state.store.inboxTabs = []
    state.route.query = { category: 'all' }
    expect(tabsFor('account').tabs.value).toEqual([])
    expect(tabsFor('account').active.value).toBeUndefined()
    expect(tabsFor('account').category.value).toBeUndefined()
  })

  it('lead to the list itself, naming the tab, Primary too', async () => {
    const { routeFor } = tabsFor('account')

    expect(routeFor('updates')).toEqual({ ...INBOX, query: { category: 'updates' } })
    expect(routeFor('all')).toEqual({ ...INBOX, query: { category: 'all' } })
    expect(routeFor('primary')).toEqual({ ...INBOX, query: { category: 'primary' } })

    // So Primary opens from another tab, whichever was last.
    state.route.query = { category: 'updates' }
    await nextTick()
    state.route.query = { category: 'primary' }
    expect(tabsFor('account').active.value).toBe('primary')
  })

  it('are chosen by turning categories on and off, Primary leading any that are on', async () => {
    const { choices, setTab } = useTabChoice()
    expect(choices.value.map((choice) => [choice.category, choice.on])).toEqual([
      ['updates', true],
      ['forums', true],
      ['promotions', true],
      ['social', false],
    ])

    await setTab('social', true)
    await setTab('forums', false)

    expect(saved).toEqual([
      { inbox_tabs: ['primary', 'updates', 'forums', 'promotions', 'social'] },
      { inbox_tabs: ['primary', 'updates', 'promotions'] },
    ])
    expect(toasts).toEqual([])
  })

  it('turn off altogether, and on again, without a toast either way', async () => {
    const { setSplit } = useTabChoice()

    await setSplit(false)
    expect(saved).toEqual([{ split_inbox: 0 }])
    await setSplit(true)
    expect(saved).toEqual([{ split_inbox: 0 }, { split_inbox: 1 }])
    expect(toasts).toEqual([])
  })

  it('build each switch on the last, while the earlier saves are still on their way', async () => {
    held.on = true
    const { setTab } = useTabChoice()

    const first = setTab('social', true)
    const second = setTab('forums', false)
    held.on = false
    held.release.forEach((release) => release())
    await Promise.all([first, second])

    expect(saved).toEqual([
      { inbox_tabs: ['primary', 'updates', 'forums', 'promotions', 'social'] },
      { inbox_tabs: ['primary', 'updates', 'promotions', 'social'] },
    ])
  })

  it('clear any list by marking all of it read, and only a bulk tab by archiving or trashing it', () => {
    const { menuFor } = useClearList(() => ({ account: 'ih', mailbox: 'inbox' }))
    const labels = (scope: Parameters<typeof menuFor>[0]) =>
      menuFor(scope).flatMap((group) => group.options.map((option) => option.label))

    expect(labels({ category: 'primary', name: 'Primary' })).toEqual(['Mark all as read'])
    expect(labels({ name: 'Archive' })).toEqual(['Mark all as read'])
    expect(labels({ category: 'updates', name: 'Updates' })).toEqual([
      'Mark all as read',
      'Archive all',
      'Move all to Trash',
    ])
  })

  it('say what a clearing did, and what its Undo put back', async () => {
    const { clear } = useClearList(() => ({ account: 'ih', mailbox: 'inbox' }))
    const updates = { category: 'updates', name: 'Updates' } as const
    const before = { id: 'c', mailbox_ids: ['inbox', 'project'], junk: 0 }

    answers.set(routes.clearList, { cleared: [{ account: 'ih', ids: ['a', 'b'] }], failed: [] })
    await clear('read', updates)
    await undoSlot.action?.()
    answers.set(routes.clearList, {
      cleared: [{ account: 'ih', ids: ['c'], mails: [before] }],
      failed: [],
    })
    await clear('archive', updates)
    await undoSlot.action?.()

    expect(toasts).toEqual([
      'Updates mail marked as read',
      'Updates mail marked as unread',
      'Updates mail archived',
      'Updates mail moved back',
    ])
    expect(saved).toContainEqual({
      action: 'archive',
      account: 'ih',
      mailbox: 'inbox',
      category: 'updates',
      filter_by: undefined,
    })
    // Undo touches exactly what was cleared, and puts it back in every folder it was in.
    expect(saved).toContainEqual({ account: 'ih', ids: ['a', 'b'], seen: false })
    expect(saved).toContainEqual({ account: 'ih', mails: [before] })
  })

  it('say so when a folder has nothing unread to mark', async () => {
    const { clear } = useClearList(() => ({ account: 'ih', mailbox: 'archive' }))
    answers.set(routes.clearList, { cleared: [], failed: [] })

    await clear('read', { name: 'Archive' })

    expect(toasts).toEqual(['Nothing unread in Archive.'])
    expect(undoSlot.action).toBeUndefined()
  })

  it('keep what an account cleared before failing undoable, and say it did not finish', async () => {
    const { clear } = useClearList(() => ({ folder: 'inbox' }))
    answers.set(routes.clearList, { cleared: [{ account: 'ih', ids: ['a'] }], failed: ['q9'] })

    await clear('read', { category: 'updates', name: 'Updates' })
    await undoSlot.action?.()

    expect(toasts).toEqual([
      'Updates mail marked as read',
      'Could not clear all Updates mail',
      'Updates mail marked as unread',
    ])
    expect(saved).toContainEqual({ account: 'ih', ids: ['a'], seen: false })
  })

  it("clear only what the list's filter shows, and say so", async () => {
    const { clear } = useClearList(() => ({ folder: 'inbox' }))

    answers.set(routes.clearList, {
      cleared: [
        { account: 'ih', ids: ['c'], mails: [{ id: 'c', mailbox_ids: ['inbox'], junk: 0 }] },
      ],
      failed: [],
    })
    await clear('archive', { category: 'social', name: 'Social', filter: 'unscreened' })
    await undoSlot.action?.()
    answers.set(routes.clearList, { cleared: [{ account: 'ih', ids: ['a'] }], failed: [] })
    await clear('read', { category: 'social', name: 'Social', filter: 'unread' })

    expect(saved).toContainEqual({
      action: 'archive',
      folder: 'inbox',
      category: 'social',
      filter_by: 'unscreened',
    })
    expect(saved).toContainEqual({
      action: 'read',
      folder: 'inbox',
      category: 'social',
      filter_by: 'unread',
    })
    expect(toasts).toEqual([
      'Social mail from unknown senders archived',
      'Social mail from unknown senders moved back',
      'Unread Social mail marked as read',
    ])
  })
})
