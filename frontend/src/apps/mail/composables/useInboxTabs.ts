import { computed, ref, shallowRef, watch } from 'vue'
import { useRoute, type RouteLocationNamedRaw } from 'vue-router'

import { api, client, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'

export type InboxCategory = 'primary' | 'updates' | 'forums' | 'promotions' | 'social'

export interface InboxTab {
  category: InboxCategory
  label: string
  icon: string
  /** Threads in the tab with unread mail. */
  unread: number
}

const TAB_LOOK: Record<InboxCategory, { label: () => string; icon: string }> = {
  primary: { label: () => __('Primary'), icon: 'lucide-inbox' },
  updates: { label: () => __('Updates'), icon: 'lucide-bell' },
  forums: { label: () => __('Forums'), icon: 'lucide-messages-square' },
  promotions: { label: () => __('Promotions'), icon: 'lucide-tag' },
  social: { label: () => __('Social'), icon: 'lucide-users' },
}

/**
 * The category tabs over an Inbox: an account's (`'account'`), or every account's at once
 * (`'unified'`), or none (`false`) for any other list. Which categories have a tab is the server's
 * answer (`inbox_tabs`); none means the Inbox isn't split. The open tab is the route's `category`,
 * Primary when it names none of them, and `undefined` when there are no tabs.
 *
 * `listRoute` is the list the tabs belong to: a tab leads there, leaving any open thread behind,
 * since that thread may not be in the tab being opened. `onSwitch` refetches the list when another
 * tab opens, as a filter change does.
 */
export const useInboxTabs = (
  scope: () => 'account' | 'unified' | false,
  listRoute: () => RouteLocationNamedRaw,
  onSwitch?: () => void,
) => {
  const route = useRoute()
  const store = userStore()

  const tabs = computed<InboxTab[]>(() => {
    const where = scope()
    if (!where) return []
    const counts = (where === 'unified' ? store.unifiedTabCounts.data : store.tabCounts.data) ?? []
    return store.inboxTabs.map((category) => ({
      category,
      label: TAB_LOOK[category].label(),
      icon: TAB_LOOK[category].icon,
      unread: counts.find((count) => count.category === category)?.unread_threads ?? 0,
    }))
  })

  const active = computed<InboxCategory | undefined>(() => {
    if (!tabs.value.length) return undefined
    return tabs.value.find((tab) => tab.category === route.query.category)?.category ?? 'primary'
  })

  const routeFor = (category: InboxCategory): RouteLocationNamedRaw => ({
    ...listRoute(),
    query: category === 'primary' ? {} : { category },
  })

  // Whether the open tab was switched to from another: the tabs stay up while it loads, the list
  // loading inline rather than the whole view giving way to the spinner.
  const switched = ref(false)
  watch(active, (tab, previous) => {
    switched.value = !!(tab && previous && tab !== previous)
    if (switched.value) onSwitch?.()
  })

  return { tabs, active, routeFor, switched }
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
 * one is always on: turning the split off is the way to one list.
 */
export const useTabChoice = () => {
  const store = userStore()
  // Not a component's mutation: turning categories off takes the tab row, and its menu, away before
  // the save is answered, and a component's mutation is cancelled when the component goes.
  const save = (input: InputOf<typeof api.mail.settings.updatePreferences>) =>
    client.mutation(api.mail.settings.updatePreferences, input)

  const offered = computed(() => !!store.userResource.data?.email_classification)
  const split = computed(() => !!store.userResource.data?.split_inbox)
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

  return {
    offered,
    split,
    choices,
    tabsFor,
    setTab,
    setSplit,
  }
}

/**
 * The menu rows that choose the tabs: a switch for the categories as a whole (a layout choice, so
 * it sits with the others), and while they are on, a group with a switch per category (Primary has
 * none, being the Inbox's own), the last one on held on. Nothing where the site doesn't sort mail
 * into categories.
 */
export const useTabChoiceMenu = () => {
  const { offered, split, choices, setTab, setSplit } = useTabChoice()
  const categoriesSwitch = computed(() =>
    offered.value
      ? {
          label: __('Categories'),
          icon: 'lucide-blocks',
          switch: true as const,
          switchValue: split.value,
          onClick: (on: boolean): void => void setSplit(on),
        }
      : undefined,
  )
  const tabGroups = computed(() => {
    if (!offered.value || !split.value) return []
    const onCount = choices.value.filter((choice) => choice.on).length
    return [
      {
        group: __('Tabs'),
        options: choices.value.map((choice) => ({
          label: choice.label,
          icon: choice.icon,
          switch: true as const,
          switchValue: choice.on,
          disabled: choice.on && onCount === 1,
          onClick: (on: boolean) => void setTab(choice.category, on),
        })),
      },
    ]
  })
  return { categoriesSwitch, tabGroups }
}

/** The name a tab goes by in the list's menu and toasts. */
export const tabName = (category: InboxCategory) => TAB_LOOK[category].label()
