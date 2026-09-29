<!--
  Mail's Settings entry points open the Suite Settings dialog on a Mail tab.
  This copy goes when Mail adopts the shell (stage 5).
-->
<template>
	<SuiteSettingsDialog v-model:open="open" :tab="tab" />
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'

import { useScreenSize, useSettings } from '@/apps/mail/utils/composables'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'

const open = defineModel<boolean>('open', { default: false })
const { settingsTab } = useSettings()
const { isMobile } = useScreenSize()

// A Mail entry point with no tab opens the first Mail tab on desktop, and the
// settings list on phone.
const tab = computed(() => settingsTab.value || (isMobile.value ? undefined : 'mail.credentials'))

// The next plain Settings click starts from the first Mail tab again.
watch(open, (isOpen) => {
	if (!isOpen) settingsTab.value = undefined
})
</script>
