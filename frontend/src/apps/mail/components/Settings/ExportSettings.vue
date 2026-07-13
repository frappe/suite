<template>
	<AppSettingsHeader :title="__('Export')" />
	<AppSettingsBody>
		<div class="flex flex-col gap-5">
			<TabButtons v-model="activeType" :buttons="typeButtons" />
			<component :is="activeComponent" :key="activeType" />
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import { type Component, computed, markRaw, ref } from 'vue'
import { TabButtons } from 'frappe-ui'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'

import CalendarExportSettings from '@/apps/mail/components/Settings/CalendarExportSettings.vue'
import ContactsExportSettings from '@/apps/mail/components/Settings/ContactsExportSettings.vue'
import MailExportSettings from '@/apps/mail/components/Settings/MailExportSettings.vue'

const activeType = ref('mail')

const typeButtons = [
	{ label: __('Mail'), value: 'mail' },
	{ label: __('Calendar'), value: 'calendar' },
	{ label: __('Contacts'), value: 'contacts' },
]

const components: Record<string, Component> = {
	mail: markRaw(MailExportSettings),
	calendar: markRaw(CalendarExportSettings),
	contacts: markRaw(ContactsExportSettings),
}

const activeComponent = computed(() => components[activeType.value])
</script>
