<template>
  <AppSettingsHeader :title="__('Inbox')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <!-- First, so the link from a screened sender's mail opens on it. -->
      <div class="divide-y divide-outline-gray-1">
        <ScreenedEmailAddressSettings />
        <InboxCategorySettings />
        <SettingsDialogRow
          :title="__('Folders')"
          :description="__('Your own folders for filing mail.')"
          :action="__('Manage')"
        >
          <FolderSettings />
        </SettingsDialogRow>
      </div>
      <AutomationSettings />
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import AutomationSettings from '@/apps/mail/components/Settings/AutomationSettings.vue'
import FolderSettings from '@/apps/mail/components/Settings/FolderSettings.vue'
import InboxCategorySettings from '@/apps/mail/components/Settings/InboxCategorySettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'
</script>
