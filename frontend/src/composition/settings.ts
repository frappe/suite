import { loadCalendarSettings } from '@/apps/calendar'
import { loadDriveSettings } from '@/apps/drive'
import { loadMailSettings } from '@/apps/mail'
import { loadMeetSettings } from '@/apps/meet'
import { loadAccountSettings, loadWorkspaceSettings } from '@/shell/settings/accountSettings'
import type { SettingsGroupLoader, SettingsTabIdOf } from '@/shell/settings/settings'

/**
 * The one Settings list, in heading order. Each loader imports its group
 * module when Settings opens [T016].
 */
export const settingsGroups = [
  loadAccountSettings,
  loadDriveSettings,
  loadMailSettings,
  loadCalendarSettings,
  loadMeetSettings,
  loadWorkspaceSettings,
] as const satisfies readonly SettingsGroupLoader[]

type CompositionTabId = SettingsTabIdOf<(typeof settingsGroups)[number]>

// Fills the shell's tab id interface, so `openSettings(tab)` takes exactly
// these ids and a misspelled id fails the type check.
declare module '@/platform/settings' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SettingsTabIds extends Record<CompositionTabId, true> {}
}
