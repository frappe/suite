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
import { ref } from 'vue'
import {
	SettingsContent,
	SettingsDialog,
	SettingsNavGroup,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from 'frappe-ui'

import { useSettingsTabs } from '@/apps/calendar/composables/useSettingsTabs'

const show = defineModel<boolean>({ default: false })

// The same list the phone's Profile page reads, so a tab added in one place shows
// up in both.
const { groups: tabGroups, tabs } = useSettingsTabs()

const activeTab = ref(tabs.value[0].value)
</script>
