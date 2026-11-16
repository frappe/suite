import type { AsyncComponentLoader, InjectionKey } from 'vue'

/**
 * One part of a tab's page that can be found by name: a row, or the dialog a
 * row opens. The page is a lazy chunk, so the tab names its parts here.
 */
export interface SettingsSection {
  /** Unique in its tab, for example `'import'`. */
  readonly id: string
  /** The part's title on the page. */
  readonly label: () => string
  /** Other words people look for it by, for example `'vacation'`. */
  readonly keywords?: () => string
}

/**
 * One row in the Settings dialog sidebar and in the phone list.
 *
 * The body is a pure component. It renders its own header and body, and it
 * does not read the dialog's state.
 */
export interface SettingsTab {
  /** Namespaced as `<group>.<tab>`, for example `'mail.inbox'`. */
  readonly id: string
  readonly label: () => string
  /** A lucide class, for example `'lucide-key-round'`. */
  readonly icon: string
  /** Cheap and synchronous. It must not load a product store. */
  readonly condition?: () => boolean
  /** Loads the body when its tab first opens. */
  readonly body: AsyncComponentLoader
  readonly sections?: readonly SettingsSection[]
}

/** One product's heading, named after the product, with its tabs. */
export interface SettingsGroup {
  readonly label: () => string
  /**
   * The app area these settings are for, such as `'mail'`. Asked for no tab,
   * Settings opens here while that area is on screen.
   */
  readonly area?: string
  readonly condition?: () => boolean
  readonly tabs: readonly SettingsTab[]
}

/**
 * Resolves one group each time Settings opens. A loader may wait for the data
 * its conditions read, so no row appears after the list shows.
 */
export type SettingsGroupLoader = () => Promise<SettingsGroup>

type TabOf<Loader> = Loader extends () => Promise<{ readonly tabs: readonly (infer Tab)[] }>
  ? Tab
  : never
type IdOf<Named> = Named extends { readonly id: infer Id extends string } ? Id : never
type SectionOf<Tab> = Tab extends { readonly sections: readonly (infer Section)[] }
  ? Section
  : never

/**
 * Each tab id a group loader resolves to, with the ids of that tab's sections.
 * A group module declares its object `as const`, so the ids stay literal and
 * need no shell import.
 */
export type SettingsSectionIdsOf<Loader> = {
  [Id in IdOf<TabOf<Loader>>]: IdOf<SectionOf<Extract<TabOf<Loader>, { readonly id: Id }>>>
}

// The tab ids live in the platform, so a product can name a tab too.
export type { SettingsTabId, SettingsTabIds } from '@/platform/settings'

/** The composition settings list, provided once at the app root. */
export const SETTINGS_GROUPS_KEY: InjectionKey<readonly SettingsGroupLoader[]> =
  Symbol('suite-settings-groups')

export interface VisibleSettingsGroup {
  readonly label: string
  readonly area?: string
  readonly tabs: readonly SettingsTab[]
}

/** Drops hidden groups, hidden tabs, and groups left with no tab. Keeps order. */
export function visibleSettingsGroups(groups: readonly SettingsGroup[]): VisibleSettingsGroup[] {
  return groups
    .flatMap((group) =>
      (group.condition?.() ?? true)
        ? [
            {
              label: group.label(),
              area: group.area,
              tabs: group.tabs.filter((tab) => tab.condition?.() ?? true),
            },
          ]
        : [],
    )
    .filter((group) => group.tabs.length > 0)
}

/**
 * The tab to show: the requested one when it is visible, else the first tab
 * of the area on screen, else the first visible tab, else nothing.
 */
export function resolveSettingsTab(
  groups: readonly VisibleSettingsGroup[],
  requested: string | undefined,
  area?: string,
): string | undefined {
  const tabs = groups.flatMap((group) => group.tabs)
  const asked = tabs.find((tab) => tab.id === requested)
  // A group with no area is no app's, so it never counts as where the user is
  const here = groups.find((group) => !!area && group.area === area)?.tabs[0]
  return (asked ?? here ?? tabs[0])?.id
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
