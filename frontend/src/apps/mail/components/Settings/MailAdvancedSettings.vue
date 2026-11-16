<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <!-- First, so Home's "import your mail" step opens on it. -->
      <ImportSettings />
      <ExportSettings />
      <CredentialsSettings />
      <MailClientSettings />
      <PushSubscriptionSettings />
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
import { translate as __ } from '@/platform/translation'
</script>
