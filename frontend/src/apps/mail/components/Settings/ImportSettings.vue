<template>
  <AppSettingsHeader :title="__('Import')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-5">
      <TabButtons v-model="activeType" :options="typeButtons" />
      <component :is="activeComponent" :key="activeType" />
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { computed, markRaw, ref, type Component } from 'vue'

import ContactsImportSettings from '@/apps/mail/components/Settings/ContactsImportSettings.vue'
import MailImportSettings from '@/apps/mail/components/Settings/MailImportSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const activeType = ref('mail')

const typeButtons = [
  { label: __('Mail'), value: 'mail' },
  { label: __('Contacts'), value: 'contacts' },
]

const components: Record<string, Component> = {
  mail: markRaw(MailImportSettings),
  contacts: markRaw(ContactsImportSettings),
}

const activeComponent = computed(() => components[activeType.value])
</script>
