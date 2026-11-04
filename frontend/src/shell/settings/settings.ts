import type { AsyncComponentLoader, InjectionKey } from 'vue'

/**
 * One row in the Settings dialog sidebar and in the phone list.
 *
 * The body is a pure component. It renders its own header and body, and it
 * does not read the dialog's state.
 */
export interface SettingsTab {
  /** Namespaced as `<group>.<tab>`, for example `'mail.screener'`. */
  readonly id: string
  readonly label: () => string
  /** A lucide class, for example `'lucide-key-round'`. */
  readonly icon: string
  /** Cheap and synchronous. It must not load a product store. */
  readonly condition?: () => boolean
  /** Loads the body when its tab first opens. */
  readonly body: AsyncComponentLoader
}

/** One product's heading, named after the product, with its tabs. */
export interface SettingsGroup {
  readonly label: () => string
  readonly condition?: () => boolean
  readonly tabs: readonly SettingsTab[]
}

/**
 * Resolves one group each time Settings opens. A loader may wait for the data
 * its conditions read, so no row appears after the list shows.
 */
export type SettingsGroupLoader = () => Promise<SettingsGroup>

/**
 * The tab ids a group loader resolves to. A group module declares its object
 * `as const`, so the ids stay literal and need no shell import.
 */
export type SettingsTabIdOf<Loader> = Loader extends () => Promise<infer Group>
  ? Group extends { readonly tabs: readonly (infer Tab)[] }
    ? Tab extends { readonly id: infer Id extends string }
      ? Id
      : never
    : never
  : never

// The tab ids live in the platform, so a product can name a tab too.
export type { SettingsTabId, SettingsTabIds } from '@/platform/settings'

/** The composition settings list, provided once at the app root. */
export const SETTINGS_GROUPS_KEY: InjectionKey<readonly SettingsGroupLoader[]> =
  Symbol('suite-settings-groups')

export interface VisibleSettingsGroup {
  readonly label: string
  readonly tabs: readonly SettingsTab[]
}

/** Drops hidden groups, hidden tabs, and groups left with no tab. Keeps order. */
export function visibleSettingsGroups(groups: readonly SettingsGroup[]): VisibleSettingsGroup[] {
  return groups
    .filter((group) => group.condition?.() ?? true)
    .map((group) => ({
      label: group.label(),
      tabs: group.tabs.filter((tab) => tab.condition?.() ?? true),
    }))
    .filter((group) => group.tabs.length > 0)
}

/**
 * The tab to show: the requested one when it is visible, else the first
 * visible tab, else nothing.
 */
export function resolveSettingsTab(
  groups: readonly VisibleSettingsGroup[],
  requested: string | undefined,
): string | undefined {
  const tabs = groups.flatMap((group) => group.tabs)
  return tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id
}

/**
 * Provided as `true` by a phone settings page. Tab bodies then drop the
 * dialog header and padding, because the page bar shows the title.
 *
 * A string, not a symbol: product bodies read it without importing the shell.
 */
export const SETTINGS_PHONE_PAGE = 'app-settings-mobile-page'

/** The id of the phone page bar's slot for a tab's header actions. */
export const SETTINGS_PAGE_ACTIONS_ID = 'app-settings-page-actions'
