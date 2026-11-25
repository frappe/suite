<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <!-- Each of these parts opens in a dialog, so they make one short list -->
    <div class="divide-y divide-outline-gray-1">
      <SettingsDialogRow
        :title="__('Rules')"
        section="mail.advanced.rules"
        :description="__('Scripts that sort and file incoming mail for you.')"
        :action="__('Manage')"
        size="xl"
      >
        <AutomationSettings />
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
import AutomationSettings from '@/apps/mail/components/Settings/AutomationSettings.vue'
import CredentialsSettings from '@/apps/mail/components/Settings/CredentialsSettings.vue'
import MailClientSettings from '@/apps/mail/components/Settings/MailClientSettings.vue'
import PushSubscriptionSettings from '@/apps/mail/components/Settings/PushSubscriptionSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'
</script>
