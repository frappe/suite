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
/** The tab `openSettings` asked for. Unset opens the first tab, or the phone list. */
export const settingsTab = ref<SettingsTabId | undefined>()

/** Opens Settings on `tab`. On phone, `tab` opens that tab's page over the list. */
export function openSettings(tab?: SettingsTabId): void {
  settingsTab.value = tab
  showSettings.value = true
}
