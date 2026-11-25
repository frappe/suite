<template>
  <AppSettingsHeader :title="__('Outgoing')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <SettingsSection :title="__('Identity')">
        <div class="divide-y divide-outline-gray-1">
          <SettingsDialogRow
            :title="__('Send-as addresses')"
            section="mail.sending.send-as"
            :description="
              __('The addresses you send mail as, each with its own name and signature.')
            "
            :action="__('Manage')"
            size="2xl"
          >
            <IdentitySettings />
          </SettingsDialogRow>
          <SettingsDialogRow
            :title="__('Signatures')"
            section="mail.sending.signatures"
            :description="__('Text added to the end of the messages you send.')"
            :action="__('Manage')"
          >
            <SignatureSettings />
          </SettingsDialogRow>
        </div>
      </SettingsSection>

      <SettingsSection :title="__('Sending')">
        <div class="divide-y divide-outline-gray-1">
          <ComposeSettings />
          <!-- Last: each one costs the copy of what you send, and a copy that was never kept can't
               be found or answered from later. -->
          <template v-if="preferences">
            <SettingsRow
              :title="__('Don’t keep sent mail')"
              :description="
                __(
                  'Mail you send isn’t saved in Sent, so you can’t find it, forward it or reply from it later.',
                )
              "
            >
              <Switch v-model="dropSentMail" />
            </SettingsRow>
            <SettingsRow
              :title="__('Don’t keep sent newsletters')"
              :description="
                __('Bulk mail your apps send through this account isn’t saved in Sent.')
              "
            >
              <Switch v-model="dropSentNewsletters" />
            </SettingsRow>
          </template>
        </div>
      </SettingsSection>

      <SettingsSection :title="__('Out of office')">
        <SettingsDialogRow
          :title="__('Auto-reply')"
          section="mail.sending.auto-reply"
          :description="autoReplyStatus ?? __('Answers mail for you while you are away.')"
          :action="__('Edit')"
          size="2xl"
        >
          <template #default="{ close }">
            <VacationResponseSettings @saved="close" />
          </template>
        </SettingsDialogRow>
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import { formatDateTime, inUserTimeZone, useMinuteClock } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { preferences, flag } = useAccountPreferences()
const dropSentMail = flag('destroy_email_after_submit')
const dropSentNewsletters = flag('destroy_newsletter_after_submit')

// The dialog reads the same reply, so a save there shows on the row
const store = userStore()
const autoReply = useQuery(
  api.mail.vacation.get,
  () => !!store.accountId && { account: store.accountId },
)
// What the reply does, said as where it stands once it is set: read without opening it. It moves
// on when a start or an end passes in a page left open
const clock = useMinuteClock()
const autoReplyStatus = computed(() => {
  const reply = autoReply.data
  if (!reply) {
    return undefined
  }

  if (!reply.enabled) {
    return undefined
  }

  const now = dayjs(clock.value)
  if (reply.from_date && inUserTimeZone(reply.from_date).isAfter(now)) {
    return __('Starts answering mail for you on {0}.', [formatDateTime(reply.from_date, 'D MMM')])
  }

  if (!reply.to_date) {
    return __('Answering mail for you now.')
  }

  const end = formatDateTime(reply.to_date, 'D MMM')
  if (inUserTimeZone(reply.to_date).isBefore(now)) {
    return __('Stopped answering mail on {0}.', [end])
  }

  return __('Answering mail for you until {0}.', [end])
})
</script>
