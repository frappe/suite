import { ref } from 'vue'

/**
 * The tab ids of the composition settings list. `composition/settings.ts`
 * fills this interface through declaration merging, so a misspelled id fails
 * the type check without the platform importing composition.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SettingsTabIds {}

export type SettingsTabId = Extract<keyof SettingsTabIds, string>

/**
 * Whether Settings is open. The shell renders the dialog from this, so a
 * product can open Settings without importing the shell.
 */
export const showSettings = ref(false)
/**
 * The tab Settings shows. `openSettings` sets it, and the dialog writes back
 * the tab the user picks, so a later `openSettings(tab)` from inside a tab
 * always switches. Unset opens the first tab, or the phone list.
 */
export const settingsTab = ref<SettingsTabId | undefined>()

/**
 * The Settings key. An app's Settings command in the palette shows it as its
 * shortcut hint, and the key runs that command.
 */
export const SETTINGS_SHORTCUT = 'Mod+Shift+Comma'

/**
 * Opens Settings on `tab`. On phone, `tab` opens that tab's page over the list.
 * Called while Settings is open, it switches to `tab`.
 */
export function openSettings(tab?: SettingsTabId): void {
  settingsTab.value = tab
  showSettings.value = true
}

/**
 * Provided as `true` by the phone settings page. A tab then drops the dialog
 * header and padding, because the page bar already shows the title.
 */
export const SETTINGS_PHONE_PAGE = 'app-settings-mobile-page'

/** The id of the phone page bar's slot for a tab's header actions. */
export const SETTINGS_PAGE_ACTIONS_ID = 'app-settings-page-actions'
