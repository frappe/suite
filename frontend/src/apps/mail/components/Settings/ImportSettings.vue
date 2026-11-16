<template>
  <SettingsSection :title="__('Import')">
    <div class="flex flex-col gap-5">
      <TabButtons v-model="activeType" :options="typeButtons" />
      <component :is="activeComponent" :key="activeType" />
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { computed, markRaw, ref, type Component } from 'vue'

import ContactsImportSettings from '@/apps/mail/components/Settings/ContactsImportSettings.vue'
import MailImportSettings from '@/apps/mail/components/Settings/MailImportSettings.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'

const activeType = ref<'mail' | 'contacts'>('mail')

const typeButtons = [
  { label: __('Mail'), value: 'mail' },
  { label: __('Contacts'), value: 'contacts' },
]

const components = {
  mail: markRaw(MailImportSettings),
  contacts: markRaw(ContactsImportSettings),
} satisfies Record<string, Component>

const activeComponent = computed(() => components[activeType.value])
</script>
