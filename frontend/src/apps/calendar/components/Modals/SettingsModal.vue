<template>
	<SettingsDialog v-model:open="show" v-model:tab="activeTab" size="5xl">
		<template #title>{{ __('Settings') }}</template>
		<SettingsSidebar>
			<SettingsNavGroup v-for="group in tabGroups" :key="group.label" :label="group.label">
				<SettingsNavItem v-for="tab in group.items" :key="tab.value" :value="tab.value">
					<template #prefix>
						<component :is="tab.icon" class="size-4 shrink-0 text-ink-gray-6" />
					</template>
					{{ tab.label }}
				</SettingsNavItem>
			</SettingsNavGroup>
		</SettingsSidebar>
		<SettingsContent>
			<SettingsPanel v-for="tab in tabs" :key="tab.value" :value="tab.value">
				<component :is="tab.component" />
			</SettingsPanel>
		</SettingsContent>
	</SettingsDialog>
</template>
<script setup lang="ts">
import { computed, markRaw, ref } from 'vue'
import { Code, Contact, HardDriveDownload, HardDriveUpload, Palette, User } from 'lucide-vue-next'
import {
	createResource,
	SettingsContent,
	SettingsDialog,
	SettingsNavGroup,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from 'frappe-ui'

import AdvancedSettings from '@/apps/calendar/components/Settings/AdvancedSettings.vue'
import AppearanceSettings from '@/apps/calendar/components/Settings/AppearanceSettings.vue'
import ExportSettings from '@/apps/calendar/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/calendar/components/Settings/ImportSettings.vue'
import ParticipantIdentitySettings from '@/apps/calendar/components/Settings/ParticipantIdentitySettings.vue'
import ProfileSettings from '@/apps/calendar/components/Settings/ProfileSettings.vue'

const show = defineModel<boolean>({ default: false })

const TAB_GROUPS = [
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

// The Advanced tab only holds the CalDAV client config, which the server withholds
// unless Mail Settings enables it — hide the whole Developer group when it's empty.
const clientConfig = createResource({
	url: 'suite.mail.api.account.get_calendar_client_config',
	cache: 'calendar-client-config',
	auto: true,
})

const tabGroups = computed(() =>
	clientConfig.data?.server_url
		? TAB_GROUPS
		: TAB_GROUPS.filter((group) => group.label !== __('Developer')),
)

const tabs = computed(() => tabGroups.value.flatMap((group) => group.items))

const activeTab = ref(tabs.value[0].value)
</script>
