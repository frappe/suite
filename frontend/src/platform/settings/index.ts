import { ref } from 'vue'

/**
 * The tab ids of the composition settings list, each with the ids of its
 * sections. `composition/settings.ts` fills this interface through declaration
 * merging, so a misspelled id fails the type check without the platform
 * importing composition.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SettingsTabIds {}

export type SettingsTabId = Extract<keyof SettingsTabIds, string>
/** One section of one tab, as `<tab id>.<section id>`: the name its row on the page answers to. */
export type SettingsSectionKey = {
  [Tab in SettingsTabId]: `${Tab}.${SettingsTabIds[Tab] & string}`
}[SettingsTabId]

/**
 * Whether Settings is open. The shell renders the dialog from this, so a
 * product can open Settings without importing the shell.
 */
export const showSettings = ref(false)
/** The tab `openSettings` asked for. Unset opens the first tab, or the phone list. */
export const settingsTab = ref<SettingsTabId | undefined>()

/**
 * The section `openSettings` asked for, as `<tab id>.<section id>`. The row on the page that goes by
 * this name opens its dialog and unsets it.
 */
export const settingsSection = ref<string | undefined>()

/**
 * Opens Settings on `tab`, and on that tab opens the dialog of `section`. On phone, `tab` opens that
 * tab's page over the list.
 */
export function openSettings<Tab extends SettingsTabId>(
  tab?: Tab,
  section?: SettingsTabIds[Tab] & string,
): void {
  settingsTab.value = tab
  settingsSection.value = undefined
  if (tab && section) {
    settingsSection.value = `${tab}.${section}`
  }

  showSettings.value = true
}
