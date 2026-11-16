<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <!-- Each part opens in a dialog, so the page is one short list. Import is first: Home's
         "import your mail" step opens this page. -->
    <div class="divide-y divide-outline-gray-1">
      <SettingsDialogRow
        :title="__('Import')"
        section="mail.advanced.import"
        :description="__('Bring in mail or contacts from a file.')"
        :action="__('Import')"
      >
        <ImportSettings />
      </SettingsDialogRow>
      <SettingsDialogRow
        :title="__('Export')"
        section="mail.advanced.export"
        :description="__('Download a copy of your mail or contacts.')"
        :action="__('Export')"
      >
        <ExportSettings />
      </SettingsDialogRow>
      <SettingsDialogRow
        :title="__('Login details')"
        section="mail.advanced.login-details"
        :description="__('The username and app password Mail connects with.')"
        :action="__('Edit')"
      >
        <template #default="{ close }">
          <CredentialsSettings @saved="close" />
        </template>
      </SettingsDialogRow>
      <!-- Two rows: Mail client setup, where the site has servers to show, and API access. -->
      <MailClientSettings />
      <SettingsDialogRow
        :title="__('Push subscriptions')"
        section="mail.advanced.push-subscriptions"
        :description="__('The devices and apps that are told when your mail changes.')"
        :action="__('Manage')"
        size="2xl"
      >
        <PushSubscriptionSettings />
      </SettingsDialogRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import CredentialsSettings from '@/apps/mail/components/Settings/CredentialsSettings.vue'
import ExportSettings from '@/apps/mail/components/Settings/ExportSettings.vue'
import ImportSettings from '@/apps/mail/components/Settings/ImportSettings.vue'
import MailClientSettings from '@/apps/mail/components/Settings/MailClientSettings.vue'
import PushSubscriptionSettings from '@/apps/mail/components/Settings/PushSubscriptionSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'
</script>
