<template>
	<h1>{{ __('Export') }}</h1>
	<TabButtons v-model="activeType" :buttons="typeButtons" />
	<component :is="activeComponent" :key="activeType" />
</template>

<script setup lang="ts">
import { type Component, computed, markRaw, ref } from 'vue'
import { TabButtons } from 'frappe-ui'

import CalendarExportSettings from '@/apps/mail/components/Settings/CalendarExportSettings.vue'
import MailExportSettings from '@/apps/mail/components/Settings/MailExportSettings.vue'

const activeType = ref('mail')

const typeButtons = [
	{ label: __('Mail'), value: 'mail' },
	{ label: __('Calendar'), value: 'calendar' },
]

const components: Record<string, Component> = {
	mail: markRaw(MailExportSettings),
	calendar: markRaw(CalendarExportSettings),
}

const activeComponent = computed(() => components[activeType.value])
</script>
