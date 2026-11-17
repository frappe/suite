<template>
  <div class="flex flex-col gap-5">
    <TabButtons v-model="activeType" :options="typeButtons" />
    <!-- Both forms sit in one cell with the other hidden, so the dialog is as tall as the taller
         one and holds still when the tab changes. -->
    <div class="grid">
      <div
        v-for="{ type, form, isHidden } in forms"
        :key="type"
        class="col-start-1 row-start-1 flex min-w-0 flex-col gap-5"
        :class="{ invisible: isHidden }"
      >
        <component :is="form" />
      </div>
    </div>
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

const forms = computed(() =>
  Object.entries(components).map(([type, form]) => ({
    type,
    form,
    isHidden: type !== activeType.value,
  })),
)
</script>
