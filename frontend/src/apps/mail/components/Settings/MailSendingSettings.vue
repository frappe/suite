<template>
  <AppSettingsHeader :title="__('Sending')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <div class="divide-y divide-outline-gray-1">
        <ComposeSettings />
        <SettingsDialogRow
          :title="__('Send-as addresses')"
          section="mail.sending.send-as"
          :description="__('The addresses you send mail as, each with its own name and signature.')"
          :action="__('Manage')"
          size="2xl"
        >
          <template #default="{ close }">
            <IdentitySettings @saved="close" />
          </template>
        </SettingsDialogRow>
        <SettingsDialogRow
          :title="__('Signatures')"
          section="mail.sending.signatures"
          :description="__('Saved signatures you can add to a message.')"
          :action="__('Manage')"
        >
          <SignatureSettings />
        </SettingsDialogRow>
        <SettingsDialogRow
          :title="__('Auto-reply')"
          section="mail.sending.auto-reply"
          :description="__('A reply sent for you while you’re away.')"
          :action="__('Edit')"
          size="2xl"
        >
          <template #default="{ close }">
            <VacationResponseSettings @saved="close" />
          </template>
        </SettingsDialogRow>
      </div>

      <!-- Apart from the routine switches: each one costs the copy of what you send, and a copy
           that was never kept can't be found or answered from later. -->
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

import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
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
