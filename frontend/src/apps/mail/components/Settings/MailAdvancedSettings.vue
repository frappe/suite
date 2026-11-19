<template>
  <AppSettingsHeader :title="__('Advanced')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
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

      <!-- Apart from the rows above: each one costs the copy of what you send, and a copy that was
           never kept can't be found or answered from later. -->
      <SettingsSection v-if="preferences" :title="__('Sent copies')">
        <div class="divide-y divide-outline-gray-1">
          <SettingsRow
            :title="__('Delete mail once it is sent')"
            :description="
              __('It is not kept in Sent, so you can’t find it, forward it or reply from it later.')
            "
          >
            <Switch v-model="dropSentMail" />
          </SettingsRow>
          <SettingsRow
            :title="__('Delete newsletters once they are sent')"
            :description="
              __(
                'Newsletters are the bulk mail your apps send through this account. They are not kept in Sent.',
              )
            "
          >
            <Switch v-model="dropSentNewsletters" />
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'

import AutomationSettings from '@/apps/mail/components/Settings/AutomationSettings.vue'
import CredentialsSettings from '@/apps/mail/components/Settings/CredentialsSettings.vue'
import MailClientSettings from '@/apps/mail/components/Settings/MailClientSettings.vue'
import PushSubscriptionSettings from '@/apps/mail/components/Settings/PushSubscriptionSettings.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { preferences, flag } = useAccountPreferences()
const dropSentMail = flag('destroy_email_after_submit')
const dropSentNewsletters = flag('destroy_newsletter_after_submit')
</script>
