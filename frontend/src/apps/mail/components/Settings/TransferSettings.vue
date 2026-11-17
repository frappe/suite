<!--
  Mail > Import & export: one tab for both directions, switched by the segmented control at the
  top of the body, each with a section for mail and one for contacts. Each starts a background
  job and emails the user when it is done.
-->
<template>
  <SettingsPage
    :description="__('Bring in mail and contacts from a file, or download a copy of them')"
  >
    <!-- The switch belongs to the forms under it, so it sits closer to the
         first one than the page gap. -->
    <div class="flex flex-col gap-6">
      <TabButtons
        :model-value="direction"
        class="self-start"
        :options="DIRECTIONS"
        @update:model-value="selectDirection"
      />
      <MailImportSection v-if="direction === 'import'" />
      <MailExportSection v-else />
    </div>
    <ContactsImportSection v-if="direction === 'import'" />
    <ContactsExportSection v-else />
  </SettingsPage>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { ref } from 'vue'

import ContactsExportSection from '@/apps/mail/components/Settings/ContactsExportSection.vue'
import ContactsImportSection from '@/apps/mail/components/Settings/ContactsImportSection.vue'
import MailExportSection from '@/apps/mail/components/Settings/MailExportSection.vue'
import MailImportSection from '@/apps/mail/components/Settings/MailImportSection.vue'
import { SettingsPage } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

type Direction = 'import' | 'export'
const DIRECTIONS: { label: string; value: Direction }[] = [
  { label: __('Import'), value: 'import' },
  { label: __('Export'), value: 'export' },
]

const direction = ref<Direction>('import')
function selectDirection(value: string | number) {
  if (value === 'import' || value === 'export') direction.value = value
}
</script>
