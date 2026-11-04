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
      />
      <FormControl
        v-model="draft.to_date"
        type="datetime-local"
        :label="__('To Date')"
        variant="outline"
      />
      <FormControl
        v-model="draft.subject"
        :label="__('Subject')"
        placeholder="Out of Office"
        variant="outline"
      />
      <div class="space-y-1.5">
        <label class="text-ink-gray-5 block text-xs">{{ __('Message') }}</label>
        <TextEditor
          editor-class="prose-sm min-h-[8rem] border rounded-b-6 border-t-0 p-2 max-w-none border-outline-gray-2"
          :placeholder="__('Type something...')"
          :fixed-menu="buttons"
          :content="draft.html_body"
          @change="(val: string) => (draft.html_body = val)"
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
import { TextEditor } from 'frappe-ui/experimental'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize, useTextEditorButtons } from '@/apps/mail/utils/composables'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const store = userStore()
const { buttons } = useTextEditorButtons()
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
    Object.assign(draft, {
      enabled: Boolean(data.enabled),
      from_date: toLocalInput(data.from_date),
      to_date: toLocalInput(data.to_date),
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
