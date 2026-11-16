<!--
  Mail > Advanced: how Suite connects to the mail server, the details for other mail apps, the
  server-side rules, and push subscriptions. Each section loads on its own.
-->
<template>
  <SettingsPage
    :title="__('Advanced')"
    :description="__('Your mail server connection, other mail apps, and server-side rules')"
  >
    <ConnectionSection />
    <MailClientsSection />
    <AutomationSection />
    <PushSubscriptionsSection />
  </SettingsPage>
</template>

<script setup lang="ts">
import AutomationSection from '@/apps/mail/components/Settings/AutomationSection.vue'
import ConnectionSection from '@/apps/mail/components/Settings/ConnectionSection.vue'
import MailClientsSection from '@/apps/mail/components/Settings/MailClientsSection.vue'
import PushSubscriptionsSection from '@/apps/mail/components/Settings/PushSubscriptionsSection.vue'
import { SettingsPage } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'
</script>
