import { loadCalendarSettings } from "@/apps/calendar";
import { loadDriveSettings } from "@/apps/drive";
import { loadMailSettings } from "@/apps/mail";
import { loadMeetSettings } from "@/apps/meet";
import { readBootFlag } from "@/platform/boot";
import {
  loadAccountSettings,
  loadWorkspaceSettings,
} from "@/shell/settings/accountSettings";
import type {
  SettingsGroupLoader,
  SettingsTabIdOf,
} from "@/shell/settings/settings";

/**
 * Drive's group shows once the files flip is on. Before it the old Drive
 * pages keep their own settings [T018].
 */
const loadDriveAreaSettings = async () => ({
  ...(await loadDriveSettings()),
  condition: () => readBootFlag("suite_flip_files"),
});

/**
 * The one Settings list, in heading order. Each loader imports its group
 * module when Settings opens [T016].
 */
export const settingsGroups = [
  loadAccountSettings,
  loadDriveAreaSettings,
  loadMailSettings,
  loadCalendarSettings,
  loadMeetSettings,
  loadWorkspaceSettings,
] as const satisfies readonly SettingsGroupLoader[];

type CompositionTabId = SettingsTabIdOf<(typeof settingsGroups)[number]>;

// Fills the shell's tab id interface, so `openSettings(tab)` takes exactly
// these ids and a misspelled id fails the type check.
declare module "@/shell/settings/settings" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SettingsTabIds extends Record<CompositionTabId, true> {}
}
