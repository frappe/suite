<template>
  <AppSettingsHeader :title="__('Inbox')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <!-- First, so the link from a screened sender's mail opens on it. -->
      <SettingsSection :title="__('Screener')">
        <div class="divide-y divide-outline-gray-1">
          <ScreenedEmailAddressSettings />
        </div>
      </SettingsSection>
      <InboxCategorySettings />
      <SettingsSection :title="__('Folders')">
        <SettingsDialogRow
          :title="__('Your folders')"
          section="mail.inbox.folders"
          :description="__('Rename, hide or delete your folders.')"
          :action="__('Manage')"
        >
          <FolderSettings />
        </SettingsDialogRow>
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import InboxCategorySettings from '@/apps/mail/components/Settings/InboxCategorySettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'
</script>
