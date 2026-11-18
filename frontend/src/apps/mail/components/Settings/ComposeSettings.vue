<template>
  <!-- Rows of the Sending page's list, there once the preferences are read. -->
  <template v-if="preferences">
    <SettingsRow
      :title="__('Undo send')"
      :description="
        __('How long a sent message waits before delivery, so you can still take it back.')
      "
    >
      <!-- The saved value goes through the fallback the composer uses, so an unset one reads as
           the default. -->
      <Select
        :model-value="String(undoSendPeriodOf(user.data))"
        :options="UNDO_SEND_OPTIONS"
        @update:model-value="saveUndoSend"
      />
    </SettingsRow>
    <SettingsRow
      :title="__('Add recipients to contacts')"
      :description="__('Saves anyone you write to as a contact, if they are not one yet.')"
    >
      <Switch v-model="createContacts" />
    </SettingsRow>
    <SettingsRow
      :title="__('Keep forwards in the conversation')"
      :description="__('A message you forward stays in the conversation it came from.')"
    >
      <Switch v-model="keepForwardedInThread" />
    </SettingsRow>
  </template>
</template>

<script setup lang="ts">
import { Select, SettingsRow, Switch } from 'frappe-ui'

import { api, client } from '@/api'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import { UNDO_SEND_PERIODS, undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import { translate as __ } from '@/platform/translation'

const { userResource: user } = userStore()
const { preferences, flag } = useAccountPreferences()
const createContacts = flag('create_contacts_after_email_submit')
const keepForwardedInThread = flag('keep_forwarded_email_in_thread')

const UNDO_SEND_OPTIONS = UNDO_SEND_PERIODS.map((seconds) => ({
  label: __('{0} seconds', [String(seconds)]),
  value: String(seconds),
}))
// Not a component's mutation: that one is cancelled when the page goes
async function saveUndoSend(period: unknown) {
  if (period !== '5' && period !== '10' && period !== '20' && period !== '30') return

  await client.mutation(api.mail.settings.updatePreferences, { undo_send_period: period })
}
</script>
