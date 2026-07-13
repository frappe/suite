<template>
	<AppSettingsHeader :title="__('Import')" />
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

import CalendarImportSettings from '@/apps/mail/components/Settings/CalendarImportSettings.vue'
import ContactsImportSettings from '@/apps/mail/components/Settings/ContactsImportSettings.vue'
import MailImportSettings from '@/apps/mail/components/Settings/MailImportSettings.vue'

const activeType = ref('mail')

const typeButtons = [
	{ label: __('Mail'), value: 'mail' },
	{ label: __('Calendar'), value: 'calendar' },
	{ label: __('Contacts'), value: 'contacts' },
]

const components: Record<string, Component> = {
	mail: markRaw(MailImportSettings),
	calendar: markRaw(CalendarImportSettings),
	contacts: markRaw(ContactsImportSettings),
}

const activeComponent = computed(() => components[activeType.value])
</script>
