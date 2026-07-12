<template>
	<SettingsDialog v-model="show" v-model:tab="activeTab" size="5xl" :shortcut="false">
		<template #title>{{ __('Settings') }}</template>
		<SettingsSidebar>
			<SettingsNavGroup>
				<SettingsNavItem v-for="tab in TABS" :key="tab.value" :value="tab.value">
					<template #prefix>
						<component :is="tab.icon" class="size-4 shrink-0 text-ink-gray-6" />
					</template>
					{{ tab.label }}
				</SettingsNavItem>
			</SettingsNavGroup>
		</SettingsSidebar>
		<SettingsContent>
			<SettingsPanel v-for="tab in TABS" :key="tab.value" :value="tab.value">
				<component :is="tab.component" />
			</SettingsPanel>
		</SettingsContent>
	</SettingsDialog>
</template>
<script setup lang="ts">
import { markRaw, ref } from 'vue'
import { Palette, User } from 'lucide-vue-next'
import {
	SettingsContent,
	SettingsDialog,
	SettingsNavGroup,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from 'frappe-ui'

import AppearanceSettings from '@/apps/calendar/components/Settings/AppearanceSettings.vue'
import ProfileSettings from '@/apps/calendar/components/Settings/ProfileSettings.vue'

const show = defineModel<boolean>({ default: false })

const TABS = [
	{
		label: __('Profile'),
		value: 'profile',
		icon: User,
		component: markRaw(ProfileSettings),
	},
	{
		label: __('Appearance'),
		value: 'appearance',
		icon: Palette,
		component: markRaw(AppearanceSettings),
	},
]

const activeTab = ref(TABS[0].value)
</script>
