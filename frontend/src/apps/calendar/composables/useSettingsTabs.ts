import { computed, markRaw, type Component } from 'vue'
import { Code, Contact, HardDriveDownload, HardDriveUpload, Palette, User } from 'lucide-vue-next'
import { createResource } from 'frappe-ui'

import { settingsGroups } from '@/composables/settingsGroups'

import AdvancedSettings from '@/apps/calendar/components/Settings/AdvancedSettings.vue'
import AppearanceSettings from '@/apps/calendar/components/Settings/AppearanceSettings.vue'
import ExportSettings from '@/apps/calendar/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/calendar/components/Settings/ImportSettings.vue'
import ParticipantIdentitySettings from '@/apps/calendar/components/Settings/ParticipantIdentitySettings.vue'
import ProfileSettings from '@/apps/calendar/components/Settings/ProfileSettings.vue'

export type SettingsTab = {
	label: string
	value: string
	icon: Component
	component: Component
}

export type SettingsGroup = {
	label: string
	items: SettingsTab[]
}

// The Advanced tab holds only the CalDAV client config, which the server withholds
// unless Mail Settings enables it — the whole Developer group goes when it is empty.
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
 * `exclude` drops rows by value — the Profile page leaves out Profile, because the
 * identity card at the top of it is what leads there.
 */
export const useSettingsTabs = (exclude: string[] = []) => {
	const allGroups = computed<SettingsGroup[]>(() => [
		{
			label: __('General'),
			items: [
				{
					label: __('Profile'),
					value: 'profile',
					icon: User,
					component: markRaw(ProfileSettings),
				},
				{
					label: __('Participant Identity'),
					value: 'participant-identity',
					icon: Contact,
					component: markRaw(ParticipantIdentitySettings),
				},
				{
					label: __('Appearance'),
					value: 'appearance',
					icon: Palette,
					component: markRaw(AppearanceSettings),
				},
			],
		},
		{
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
		...(clientConfig.data?.server_url
			? [
					{
						label: __('Developer'),
						items: [
							{
								label: __('Advanced'),
								value: 'advanced',
								icon: Code,
								component: markRaw(AdvancedSettings),
							},
						],
					},
				]
			: []),
	])

	const { groups, findTab } = settingsGroups(allGroups, exclude)
	const tabs = computed(() => groups.value.flatMap((group) => group.items))

	return { groups, tabs, findTab }
}
