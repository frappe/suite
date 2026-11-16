<template>
  <div class="flex flex-col gap-5">
    <TabButtons v-model="activeType" :options="typeButtons" />
    <component :is="activeComponent" :key="activeType" />
  </div>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { computed, markRaw, ref, type Component } from 'vue'

import ContactsExportSettings from '@/apps/mail/components/Settings/ContactsExportSettings.vue'
import MailExportSettings from '@/apps/mail/components/Settings/MailExportSettings.vue'

const activeType = ref<'mail' | 'contacts'>('mail')

const typeButtons = [
  { label: __('Mail'), value: 'mail' },
  { label: __('Contacts'), value: 'contacts' },
]

const components = {
  mail: markRaw(MailExportSettings),
  contacts: markRaw(ContactsExportSettings),
} satisfies Record<string, Component>

const activeComponent = computed(() => components[activeType.value])
</script>
