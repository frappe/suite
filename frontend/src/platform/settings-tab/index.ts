/**
 * The building blocks of a Settings tab body. The shell owns the dialog; a
 * product owns its tabs and builds each one from these, so every tab has the
 * same header, sections, rows, lists, empty, loading and save behaviour:
 *
 *   SettingsPage            one per tab: title, description, #actions, loading, load failure
 *     SettingsSection       heading, description, #actions ("New"), content
 *       SettingsRow         a single setting, saved on change (from frappe-ui)
 *       SettingsListRow     an item of a management list, with its menu
 *       SettingsSelectionBar  select all, the count and bulk actions of a list
 *                           (with `useSettingsSelection`)
 *       SettingsEmpty       a list or section with nothing in it
 *       SettingsForm        several text fields with one Save button
 *       SettingsCopyField   a read-only value with a copy button
 *       SettingsJobStatus   the status line and start button of an import or export
 *
 *   useJobDoneRefetch       reads the running job of a SettingsJobStatus again when it finishes
 *   copyValue               copy a value with the same feedback as SettingsCopyField
 *   useSettingsDraft        the draft of a form or dialog with a Save button, and whether it changed
 *   useSavedFields          the values of switches and selects that save on change, and their saves
 *
 * A tab is loaded only when it opens, so this module stays apart from
 * `@/platform/settings` (tab ids and `openSettings`), which loads with the app.
 *
 * To point at a setting another tab owns, put a `SettingsRow` with a button
 * that calls `openSettings('<tab id>')` from `@/platform/settings`; it
 * switches tabs while Settings is open.
 */
export { copyValue } from './copyValue'
export { default as SettingsCopyField } from './SettingsCopyField.vue'
export { default as SettingsEmpty } from './SettingsEmpty.vue'
export { default as SettingsForm } from './SettingsForm.vue'
export { default as SettingsJobStatus } from './SettingsJobStatus.vue'
export { default as SettingsListRow } from './SettingsListRow.vue'
export { default as SettingsLoading } from './SettingsLoading.vue'
export { default as SettingsPage } from './SettingsPage.vue'
export { default as SettingsSection } from './SettingsSection.vue'
export { default as SettingsSelectionBar } from './SettingsSelectionBar.vue'
export { useJobDoneRefetch, type JobOperation } from './useJobDoneRefetch'
export { useSavedFields } from './useSavedFields'
export { useSettingsDraft } from './useSettingsDraft'
export { useSettingsSelection, type SettingsSelection } from './useSettingsSelection'
