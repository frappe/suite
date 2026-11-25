import { calendarSettings } from '@/apps/calendar'
import { driveSettings } from '@/apps/drive'
import { mailSettings } from '@/apps/mail'
import { translate as __ } from '@/platform/translation'
import { accountSettings } from '@/shell/settings/accountSettings'
import type { SettingsGroup, SettingsSectionIdsOf } from '@/shell/settings/settings'

/**
 * Account, with Mail's own locale and time zone in Preferences, and Storage last: what Drive and Mail each hold against their own quota, in one tab
 * because a person asks how full they are, not which app is.
 */
const [profile, preferences] = accountSettings.tabs
const account = {
  ...accountSettings,
  tabs: [
    profile,
    {
      ...preferences,
      body: () => import('@/composition/PreferencesSettings.vue'),
      sections: [
        ...preferences.sections,
        { id: 'mail-locale', label: () => __('Mail locale') },
        { id: 'mail-time-zone', label: () => __('Mail time zone') },
      ],
    },
    {
      id: 'account.storage',
      label: () => __('Storage'),
      icon: 'lucide-chart-pie',
      keywords: () => __('quota, space, disk'),
      // A phone shows Mail's storage on its Settings page, outside the list.
      onPhone: false,
      body: () => import('@/composition/StorageSettings.vue'),
      sections: [
        { id: 'drive', label: () => __('Drive storage') },
        { id: 'mail', label: () => __('Mail storage') },
      ],
    },
  ],
} as const

/**
 * The one Settings list, in heading order. It is part of the app rather than
 * a download of its own, so Settings shows its rows at once; each tab's page
 * still loads when it opens.
 *
 * Meet is absent: its settings only mean anything inside a call, so the
 * in-call dialog owns them (`apps/meet/settings`).
 */
export const settingsGroups = [
  account,
  driveSettings,
  mailSettings,
  calendarSettings,
] as const satisfies readonly SettingsGroup[]

type CompositionSectionIds = SettingsSectionIdsOf<(typeof settingsGroups)[number]>

// Fills the shell's tab id interface, so `openSettings(tab, section)` takes
// exactly these ids and a misspelled id fails the type check
declare module '@/platform/settings' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SettingsTabIds extends CompositionSectionIds {}
}
