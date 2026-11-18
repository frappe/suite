<template>
  <AppSettingsHeader :title="__('Sending')" />
  <AppSettingsBody>
    <div class="divide-y divide-outline-gray-1">
      <ComposeSettings />
      <SettingsDialogRow
        :title="__('Send-as addresses')"
        section="mail.sending.send-as"
        :description="__('The addresses you send mail as, each with its own name and signature.')"
        :action="__('Manage')"
        size="2xl"
      >
        <IdentitySettings />
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
        :status="autoReplyStatus"
        :action="__('Edit')"
        size="2xl"
      >
        <template #default="{ close }">
          <VacationResponseSettings @saved="close" />
        </template>
      </SettingsDialogRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
import { userStore } from '@/apps/mail/stores/user'
import { formatDateTime, inUserTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'

// The dialog reads the same reply, so a save there shows on the row
const store = userStore()
const autoReply = useQuery(
  api.mail.vacation.get,
  () => !!store.accountId && { account: store.accountId },
)
const autoReplyStatus = computed(() => {
  const reply = autoReply.data
  if (!reply) {
    return undefined
  }

  if (!reply.enabled) {
    return __('Off')
  }

  const now = dayjs()
  if (reply.from_date && inUserTimeZone(reply.from_date).isAfter(now)) {
    return __('Starts {0}', [formatDateTime(reply.from_date, 'D MMM')])
  }

  if (!reply.to_date) {
    return __('On')
  }

  const end = formatDateTime(reply.to_date, 'D MMM')
  if (inUserTimeZone(reply.to_date).isBefore(now)) {
    return __('Ended {0}', [end])
  }

  return __('On until {0}', [end])
})
</script>
