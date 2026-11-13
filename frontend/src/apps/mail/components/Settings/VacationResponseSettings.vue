<template>
  <AppSettingsHeader :title="__('Vacation Response')">
    <template v-if="vacationResponse.data" #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="isMobile ? 'md' : 'sm'"
        :disabled="vacationResponse.isFetching || JSON.stringify(draft) === original"
        :loading="updateVacationResponse.isPending"
        @click="handleSave"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <div v-if="vacationResponse.data" class="flex flex-col gap-5">
      <SettingsRow
        class="!py-0"
        :title="__('Enabled')"
        :description="__('Auto-reply to incoming mails while you’re away.')"
      >
        <Switch v-model="draft.enabled" />
      </SettingsRow>
      <FormControl
        v-model="draft.from_date"
        type="datetime-local"
        :label="__('From Date')"
        variant="outline"
        :disabled="!draft.enabled"
      />
      <FormControl
        v-model="draft.to_date"
        type="datetime-local"
        :label="__('To Date')"
        variant="outline"
        :disabled="!draft.enabled"
      />
      <FormControl
        v-model="draft.subject"
        :label="__('Subject')"
        :placeholder="__('Out of office')"
        variant="outline"
        :disabled="!draft.enabled"
      />
      <div class="space-y-1.5">
        <label class="text-ink-gray-5 block text-xs">{{ __('Message') }}</label>
        <MailRichTextField
          v-model="draft.html_body"
          :placeholder="__('Type something...')"
          :div-paragraphs="false"
          :editable="draft.enabled"
        />
      </div>
      <SetSieveScriptStateModal
        v-model="showConfirmDialog"
        :script="{ _name: 'vacation', active: 0 }"
        :action="updateVacationResponseSubmit"
      />
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const store = userStore()
const { isMobile } = useScreenSize()
const showConfirmDialog = ref(false)
const activeSieveScript = computed(
  () => store.sieveScripts.data?.find((s) => s.active && s._name !== 'vacation')?._name,
)
const handleSave = () => {
  if (activeSieveScript.value && draft.enabled) showConfirmDialog.value = true
  else updateVacationResponseSubmit()
}
const draft = reactive({
  enabled: false,
  from_date: '',
  to_date: '',
  subject: '',
  html_body: '',
})
const original = ref('')
const vacationResponse = useQuery(api.mail.vacation.get, () =>
  store.accountId
    ? {
        account: store.accountId,
      }
    : false,
)
watch(
  () => vacationResponse.data,
  (data) => {
    if (!data) return
    // An absence that is off and over is history, not a default: its dates go, so turning the
    // responder on again starts from nothing rather than last year's trip. Its words stay, to reuse.
    const over = !data.enabled && !!data.to_date && dayjs.utc(data.to_date).isBefore(dayjs())
    Object.assign(draft, {
      enabled: Boolean(data.enabled),
      from_date: over ? '' : toLocalInput(data.from_date),
      to_date: over ? '' : toLocalInput(data.to_date),
      subject: data.subject ?? '',
      html_body: data.html_body ?? '',
    })
    original.value = JSON.stringify(draft)
  },
  {
    immediate: true,
  },
)
const updateVacationResponse = useMutation(api.mail.vacation.update)
async function updateVacationResponseSubmit() {
  const input: InputOf<typeof api.mail.vacation.update> = {
    account: store.accountId,
    enabled: draft.enabled,
    from_date: fromLocalInput(draft.from_date),
    to_date: fromLocalInput(draft.to_date),
    subject: draft.subject,
    html_body: draft.html_body,
  }
  await updateVacationResponse.run(input)
  await vacationResponse.refetch()
  raiseToast(__('Vacation response updated.'))
  showConfirmDialog.value = false
}
</script>
