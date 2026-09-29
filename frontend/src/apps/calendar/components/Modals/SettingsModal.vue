<!--
  Calendar's Settings entry points open the Suite Settings dialog on the first
  Calendar tab. This copy goes when Calendar adopts the shell (stage 5).
-->
<template>
	<SuiteSettingsDialog v-model:open="open" tab="calendar.calendars" />
</template>

<script setup lang="ts">
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'

const open = defineModel<boolean>('open', { default: false })
</script>
