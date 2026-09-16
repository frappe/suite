<template>
	<SuiteSettingsDialog
		v-model:open="open"
		v-model:tab="activeTab"
		:groups="groups"
		:include-common="false"
	/>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useSettingsTabs } from '@/apps/calendar/composables/useSettingsTabs'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'

const open = defineModel<boolean>('open', { default: false })
// The same list the phone's Profile page reads, so a tab added in one place shows
// up in both.
const { groups, tabs } = useSettingsTabs()
const activeTab = ref(tabs.value[0].value)
</script>
