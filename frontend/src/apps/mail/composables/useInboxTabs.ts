import { useStorage } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'
import { useRoute, type RouteLocationNamedRaw } from 'vue-router'

import { api, client, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'

export type InboxCategory = 'primary' | 'updates' | 'forums' | 'promotions' | 'social'

/** A tab over a split Inbox: a category's, or All mail, every category in one list. */
export type InboxTabId = InboxCategory | 'all'

export interface InboxTab {
  id: InboxTabId
  label: string
  icon: string
  /** Threads in the tab with unread mail. */
  unread: number
}

const TAB_LOOK: Record<InboxTabId, { label: () => string; icon: string }> = {
  primary: { label: () => __('Primary'), icon: 'lucide-inbox' },
  updates: { label: () => __('Updates'), icon: 'lucide-bell' },
  forums: { label: () => __('Forums'), icon: 'lucide-messages-square' },
  promotions: { label: () => __('Promotions'), icon: 'lucide-tag' },
  social: { label: () => __('Social'), icon: 'lucide-users' },
  all: { label: () => __('All mail'), icon: 'lucide-mails' },
}

// The Inbox tab last opened on this device, the one a bare link to the Inbox opens.
const LAST_TAB_KEY = 'mail-inbox-tab'

/**
 * The category tabs over an Inbox: an account's (`'account'`), or every account's at once
 * (`'unified'`), or none (`false`) for any other list. Which categories have a tab is the server's
 * answer (`inbox_tabs`); none means the Inbox isn't split. A split Inbox ends with All mail, the
 * whole Inbox whatever each thread's category, for those who would rather not sort by it, unless the
 * person turned it off (`all_mail_tab`); its count is the Inbox's own, as the sidebar gives it.
 *
 * The open tab is the route's `category`. A route that names none of them opens the tab last opened
 * on this device, so the Inbox reopens where it was left, and Primary when that has no tab now.
 * `undefined` when there are no tabs. `category` is what the list asks for: the open tab's, and none
 * in All mail or where there are no tabs.
 *
 * A phone draws the categories other than Primary as cards over it (CategoryCards), not tabs.
 *
 * `listRoute` is the list the tabs belong to: a tab leads there, leaving any open thread behind,
 * since that thread may not be in the tab being opened. `onSwitch` starts the list over when another
 * tab opens: unfiltered, and refetched.
 */
export const useInboxTabs = (
  scope: () => 'account' | 'unified' | false,
  listRoute: () => RouteLocationNamedRaw,
  onSwitch?: () => void,
) => {
  const route = useRoute()
  const store = userStore()
  const lastTab = useStorage<string>(LAST_TAB_KEY, '')

  // The whole Inbox's unread threads: the account's Inbox, or the Inbox merged across accounts (a
  // system folder's slug is its role).
  const inboxUnread = (where: 'account' | 'unified') =>
    (where === 'unified'
      ? store.unifiedFolders.data?.find((folder) => folder.slug === 'inbox')?.unread_threads
      : store.mailboxes.data?.find((mailbox) => mailbox.id === store.mailboxIds.inbox)
          ?.unread_threads) ?? 0

  const tabs = computed<InboxTab[]>(() => {
    const where = scope()
    if (!where || !store.inboxTabs.length) return []
    const counts = (where === 'unified' ? store.unifiedTabCounts.data : store.tabCounts.data) ?? []
    const tab = (id: InboxTabId, unread: number): InboxTab => ({
      id,
      label: TAB_LOOK[id].label(),
      icon: TAB_LOOK[id].icon,
      unread,
    })
    return [
      ...store.inboxTabs.map((category) =>
        tab(category, counts.find((count) => count.category === category)?.unread_threads ?? 0),
      ),
      ...(store.userResource.data?.all_mail_tab ? [tab('all', inboxUnread(where))] : []),
    ]
  })

  const active = computed<InboxTabId | undefined>(() => {
    if (!tabs.value.length) return undefined
    const named = (id: unknown) => tabs.value.find((tab) => tab.id === id)?.id
    return named(route.query.category) ?? named(lastTab.value) ?? 'primary'
  })
  const category = computed<InboxCategory | undefined>(() =>
    active.value === 'all' ? undefined : active.value,
  )

  // Every tab is named in its link, Primary too: a bare link opens the last tab (see `active`).
  const routeFor = (id: InboxTabId): RouteLocationNamedRaw => ({
    ...listRoute(),
    query: { category: id },
  })

  watch(
    active,
    (tab) => {
      if (tab) lastTab.value = tab
    },
    { immediate: true },
  )
  watch(active, (tab, previous) => {
    if (tab && previous && tab !== previous) onSwitch?.()
  })

  return { tabs, active, category, routeFor }
}

/** The categories a person can give a tab or not: all but Primary, which is the Inbox's own. */
const CHOOSABLE: InboxCategory[] = ['updates', 'forums', 'promotions', 'social']

// The choice on its way to the server, ahead of the user info that will confirm it. A switch flipped
// while another save is pending builds on it, rather than on the choice from before both (and so
// undoing the first). Shared by every place the choice is made. Shallow, so a save can tell its own
// choice from a later one by identity.
const pendingTabs = shallowRef<InboxCategory[] | null>(null)

/**
 * The person's categories: offered when the site sorts mail into them at all; whether their Inbox is
 * split into them; and which have a tab when it is, a choice kept while the split is off. At least
 * one is always on: turning the split off is the way to one list. Apart from them, whether the tabs
 * end with All mail.
 */
export const useTabChoice = () => {
  const store = userStore()
  // Not a component's mutation: turning categories off takes the tab row, and its menu, away before
  // the save is answered, and a component's mutation is cancelled when the component goes.
  const save = (input: InputOf<typeof api.mail.settings.updatePreferences>) =>
    client.mutation(api.mail.settings.updatePreferences, input)

  const offered = computed(() => !!store.userResource.data?.email_classification)
  const split = computed(() => !!store.userResource.data?.split_inbox)
  const allMail = computed(() => !!store.userResource.data?.all_mail_tab)
  const chosen = computed(() => pendingTabs.value ?? store.userResource.data?.inbox_tabs ?? [])
  const choices = computed(() =>
    CHOOSABLE.map((category) => ({
      category,
      label: TAB_LOOK[category].label(),
      icon: TAB_LOOK[category].icon,
      on: chosen.value.includes(category),
    })),
  )

  /** Which categories have a tab (Primary leads them). */
  const tabsFor = (categories: InboxCategory[]): InboxCategory[] => {
    const on = CHOOSABLE.filter((category) => categories.includes(category))
    return on.length ? ['primary', ...on] : []
  }
  const saveTabs = async (categories: InboxCategory[]) => {
    const tabs = tabsFor(categories)
    pendingTabs.value = tabs
    try {
      await save({ inbox_tabs: tabs })
    } finally {
      // A later switch's choice stays pending until its own save lands.
      if (pendingTabs.value === tabs) pendingTabs.value = null
    }
  }
  const setTab = (category: InboxCategory, on: boolean) =>
    saveTabs(
      choices.value
        .filter((choice) => (choice.category === category ? on : choice.on))
        .map((choice) => choice.category),
    )

  // A switch in the view menu, which stays where it is either way: no toast, nothing to undo.
  const setSplit = (on: boolean) => save({ split_inbox: on ? 1 : 0 })
  // The same, for the All mail tab.
  const setAllMail = (on: boolean) => save({ all_mail_tab: on ? 1 : 0 })

  return {
    offered,
    split,
    allMail,
    choices,
    tabsFor,
    setTab,
    setSplit,
    setAllMail,
  }
}

/**
 * The menu rows that choose the tabs, layout choices to sit with the others: a switch for the
 * categories as a whole, and while they are on, a Tabs row opening a submenu with a switch per
 * category (Primary has none, being the Inbox's own), the last one on held on, and one for All mail
 * after them. Folded away, the switches don't outnumber the rest of the menu. Nothing where the
 * site doesn't sort mail into categories.
 */
export const useTabChoiceMenu = () => {
  const { offered, split, allMail, choices, setTab, setSplit, setAllMail } = useTabChoice()
  const categoriesSwitch = computed(() => ({
    label: __('Categories'),
    icon: 'lucide-blocks',
    switch: true as const,
    switchValue: split.value,
    onClick: (on: boolean): void => void setSplit(on),
  }))
  // A switch per category, the last one on held on.
  const categorySwitches = computed(() => {
    const onCount = choices.value.filter((choice) => choice.on).length
    return choices.value.map((choice) => ({
      label: choice.label,
      icon: choice.icon,
      switch: true as const,
      switchValue: choice.on,
      disabled: choice.on && onCount === 1,
      onClick: (on: boolean) => void setTab(choice.category, on),
    }))
  })
  const tabsSubmenu = computed(() => ({
    label: __('Tabs'),
    icon: 'lucide-panel-top',
    submenu: [
      ...categorySwitches.value,
      {
        label: TAB_LOOK.all.label(),
        icon: TAB_LOOK.all.icon,
        switch: true as const,
        switchValue: allMail.value,
        disabled: false,
        onClick: (on: boolean) => void setAllMail(on),
      },
    ],
  }))
  const rows = computed(() => {
    if (!offered.value) return []
    return split.value ? [categoriesSwitch.value, tabsSubmenu.value] : [categoriesSwitch.value]
  })
  return { rows, offered, split, categoriesSwitch, categorySwitches }
}

/** The name a tab goes by in the list's menu and toasts. */
export const tabName = (tab: InboxTabId) => TAB_LOOK[tab].label()
