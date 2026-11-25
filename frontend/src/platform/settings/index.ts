import { ref, watch, type InjectionKey, type Ref } from 'vue'

import { slideChange } from '@/platform/page-slide'

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
 * The section `openSettings` asked for, as `<tab id>.<section id>`. The part of the page that goes
 * by this name shows itself and unsets it.
 */
export const settingsSection = ref<string | undefined>()

/** The Settings page on a phone that a part it opens lays its own page over. */
export const SETTINGS_PHONE_PAGE_EL: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('settings-phone-page-el')

/** The element at a row dialog's bottom that `<SettingsDialogActions>` teleports into. */
export const SETTINGS_DIALOG_ACTIONS_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('settings-dialog-actions')

/** The bar of a part's page on a phone, where `<SettingsDialogActions bar>` teleports to. */
export const SETTINGS_PART_BAR_KEY: InjectionKey<Readonly<Ref<HTMLElement | null>>> =
  Symbol('settings-part-bar')

/**
 * Runs `show` when Settings asks for this section. Each asking is answered once: the page shown
 * again later does not show the section again. Called in a component's setup.
 */
export function onSettingsSectionAsked(
  section: () => SettingsSectionKey | undefined,
  show: () => void,
): void {
  function answer() {
    const name = section()
    if (name && settingsSection.value === name) {
      settingsSection.value = undefined
      show()
    }
  }

  watch(settingsSection, answer, { immediate: true })
}

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

// The phone's settings page, once it is on screen: what a slide into it waits for before picturing
// it. Its module and its tab load on the first opening, so a tick is not always enough.
let pageShown: (() => void) | undefined

/** Called by the phone's settings drill-in once a tab's page is on screen. */
export function settingsPageShown(): void {
  pageShown?.()
  pageShown = undefined
}

/**
 * A tab of Settings opened on a phone as a page pushed over the one it is opened from, sliding in
 * from the right, as a thread or a category does.
 */
export function openSettingsPage<Tab extends SettingsTabId>(tab: Tab): Promise<void> {
  return slideChange('forward', async () => {
    const shown = new Promise<void>((done) => {
      // An earlier opening still waiting goes on without its page
      pageShown?.()
      pageShown = done
      // A page that never says so (a tab that failed to load) goes without waiting.
      setTimeout(done, 400)
    })
    openSettings(tab)
    await shown
  })
}
