<template>
  <!-- Rows of the Sending page's list, there once the preferences are read. -->
  <template v-if="preferences">
    <SettingsRow
      :title="__('Default outgoing email')"
      :description="__('The address selected automatically when composing a message.')"
    >
      <Combobox
        trigger="button"
        align="end"
        :model-value="preferences.default_outgoing_email"
        :options="addresses"
        @update:model-value="setDefaultOutgoing"
      />
    </SettingsRow>
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
      :title="__('Create contacts after sending email')"
      :description="__('Automatically creates contacts for new recipients after an email is sent.')"
    >
      <Switch v-model="createContacts" />
    </SettingsRow>
    <SettingsRow
      :title="__('Keep forwarded email in thread')"
      :description="__('Keep forwarded emails in the original thread.')"
    >
      <Switch v-model="keepForwardedInThread" />
    </SettingsRow>
  </template>
</template>

<script setup lang="ts">
import { Combobox, Select, SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation } from '@/api'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import { userStore } from '@/apps/mail/stores/user'
import type { Identity } from '@/apps/mail/types'
import { UNDO_SEND_PERIODS, undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import { translate as __ } from '@/platform/translation'

const { identities, userResource: user } = userStore()
const { preferences, change, flag } = useAccountPreferences()
const createContacts = flag('create_contacts_after_email_submit')
const keepForwardedInThread = flag('keep_forwarded_email_in_thread')

const addresses = computed(() =>
  (identities.data ?? []).map((identity: Identity) => identity.email),
)

// The control can also hand back nothing; an address is all there is to save
async function setDefaultOutgoing(email: unknown) {
  if (typeof email !== 'string') return

  await change({ default_outgoing_email: email })
}

const UNDO_SEND_OPTIONS = UNDO_SEND_PERIODS.map((seconds) => ({
  label: __('{0} seconds', [String(seconds)]),
  value: String(seconds),
}))
const undoSend = useMutation(api.mail.settings.updatePreferences)
async function saveUndoSend(period: unknown) {
  if (period !== '5' && period !== '10' && period !== '20' && period !== '30') return

  await undoSend.run({ undo_send_period: period })
}
</script>
