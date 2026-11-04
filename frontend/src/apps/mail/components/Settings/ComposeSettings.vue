<template>
  <AppSettingsHeader :title="__('Compose')">
    <template #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="isMobile ? 'md' : 'sm'"
        :loading="saveSettings.isPending"
        :disabled="isNotDirty"
        @click="save()"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <div class="flex flex-col gap-5">
      <SettingsRow
        class="!py-0"
        :title="__('Undo Send')"
        :description="
          __('How long a sent message waits before delivery, so you can still take it back.')
        "
      >
        <Select v-model="undoSendPeriod" :options="UNDO_SEND_OPTIONS" />
      </SettingsRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, Select, SettingsRow } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { UNDO_SEND_PERIODS, undoSendPeriodOf } from '@/apps/mail/utils/undoSend'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const user = userStore().userResource
const { isMobile } = useScreenSize()

// The select speaks the Select field's strings; the saved value is compared through the same
// fallback the composer uses, so an unset row reads as the default rather than as dirty.
const savedPeriod = computed(() => String(undoSendPeriodOf(user.data)))
const undoSendPeriod = ref(savedPeriod.value)
const isNotDirty = computed(() => undoSendPeriod.value === savedPeriod.value)

const saveSettings = useMutation(api.mail.settings.updatePreferences)
async function save() {
  const period = undoSendPeriod.value
  if (period !== '5' && period !== '10' && period !== '20' && period !== '30') return
  await saveSettings.run({ undo_send_period: period })
  raiseToast(__('Compose settings updated.'))
}

const UNDO_SEND_OPTIONS = UNDO_SEND_PERIODS.map((seconds) => ({
  label: __('{0} seconds', [String(seconds)]),
  value: String(seconds),
}))
</script>
