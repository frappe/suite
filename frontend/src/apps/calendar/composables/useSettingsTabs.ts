import { computed, markRaw } from 'vue'
import { CalendarDays, Code, Contact, HardDriveDownload, HardDriveUpload } from 'lucide-vue-next'
import { createResource } from 'frappe-ui'

import { getVisibleSettingsGroups } from '@/components/settings/settingsCatalog'
import type { SettingsGroup } from '@/components/settings/types'
import { useCommonSettingsGroups } from '@/components/settings/useCommonSettingsGroups'
import { settingsGroups } from '@/composables/settingsGroups'

import AdvancedSettings from '@/apps/calendar/components/Settings/AdvancedSettings.vue'
import CalendarsSettings from '@/apps/calendar/components/Settings/CalendarsSettings.vue'
import ExportSettings from '@/apps/calendar/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/calendar/components/Settings/ImportSettings.vue'
import ParticipantIdentitySettings from '@/apps/calendar/components/Settings/ParticipantIdentitySettings.vue'

export type { SettingsTab } from '@/components/settings/types'

// The Advanced tab holds only the CalDAV client config, which the server withholds
// unless Mail Settings enables it - the whole Developer group goes when it is empty.
const clientConfig = createResource({
	url: 'suite.mail.api.account.get_calendar_client_config',
	cache: 'calendar-client-config',
	auto: true,
})

/**
 * The calendar's settings, as one list read by both of its surfaces: the desktop
 * SettingsDialog, which renders the groups as its sidebar, and the phone's Profile
 * page, which renders them as rows. One list, so the two cannot drift.
 *
 * `exclude` drops rows by value - the Profile page leaves out Profile, because the
 * identity card at the top of it is what leads there.
 */
export const useSettingsTabs = (exclude: string[] = []) => {
	const commonGroups = useCommonSettingsGroups()
	const allGroups = computed<SettingsGroup[]>(() =>
		getVisibleSettingsGroups([
			...commonGroups.value.map((group) => ({
				...group,
				label: __(group.label),
				items: group.items.map((tab) => ({ ...tab, label: __(tab.label) })),
			})),
			{
				id: 'calendar',
				label: __('Calendar'),
				items: [
					{
						label: __('Calendars'),
						value: 'calendars',
						icon: CalendarDays,
						component: markRaw(CalendarsSettings),
					},
					{
						label: __('Participant Identity'),
						value: 'participant-identity',
						icon: Contact,
						component: markRaw(ParticipantIdentitySettings),
					},
				],
			},
			{
				id: 'calendar-data',
				label: __('Data'),
				items: [
					{
						label: __('Import'),
						value: 'import',
						icon: HardDriveDownload,
						component: markRaw(ImportSettings),
					},
					{
						label: __('Export'),
						value: 'export',
						icon: HardDriveUpload,
						component: markRaw(ExportSettings),
					},
				],
			},
			{
				id: 'calendar-developer',
				label: __('Developer'),
				condition: () => Boolean(clientConfig.data?.server_url),
				items: [
					{
						label: __('Advanced'),
						value: 'advanced',
						icon: Code,
						component: markRaw(AdvancedSettings),
					},
				],
			},
		]),
	)

	const { groups, findTab } = settingsGroups(allGroups, exclude)
	const tabs = computed(() => groups.value.flatMap((group) => group.items))

	return { groups, tabs, findTab }
}
