<!--
  Mail > Import & export: one tab for both directions, switched by the segmented control at the
  top of the body, each with a section for mail and one for contacts. Each starts a background
  job and emails the user when it is done.
-->
<template>
  <SettingsPage
    :title="__('Import & export')"
    :description="__('Bring in mail and contacts from a file, or download a copy of them')"
  >
    <TabButtons v-model="direction" class="self-start" :options="DIRECTIONS" />
    <template v-if="direction === 'import'">
      <SettingsSection
        :title="__('Mail')"
        :description="__('Messages from another mail service, in .eml, mbox or Maildir files')"
      >
        <MailImportSettings />
      </SettingsSection>
      <SettingsSection
        :title="__('Contacts')"
        :description="__('People from another address book, in .vcf files')"
      >
        <ContactsImportSettings />
      </SettingsSection>
    </template>
    <template v-else>
      <SettingsSection
        :title="__('Mail')"
        :description="__('An archive of your messages, to keep or to move to another service')"
      >
        <MailExportSettings />
      </SettingsSection>
      <SettingsSection :title="__('Contacts')" :description="__('An archive of your contacts')">
        <ContactsExportSettings />
      </SettingsSection>
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { TabButtons } from 'frappe-ui'
import { ref } from 'vue'

import ContactsExportSettings from '@/apps/mail/components/Settings/ContactsExportSettings.vue'
import ContactsImportSettings from '@/apps/mail/components/Settings/ContactsImportSettings.vue'
import MailExportSettings from '@/apps/mail/components/Settings/MailExportSettings.vue'
import MailImportSettings from '@/apps/mail/components/Settings/MailImportSettings.vue'
import { SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const DIRECTIONS = [
  { label: __('Import'), value: 'import' },
  { label: __('Export'), value: 'export' },
]

const direction = ref<string | number>('import')
</script>
