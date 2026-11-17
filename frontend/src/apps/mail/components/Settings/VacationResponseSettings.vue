<!--
  Mail > Vacation response: an automatic reply to mail that comes in while you are away. The
  switch, the dates and the message save together.
-->
<template>
  <SettingsPage
    :title="__('Vacation response')"
    :description="__('Reply automatically to mail that comes in while you are away')"
    :loading="!vacationResponse.data"
    :reads="[vacationResponse, store.userResource]"
  >
    <SettingsSection v-if="vacationResponse.data">
      <SettingsForm :dirty="dirty" :save="handleSave">
        <!-- -mt-2 takes back the form's top padding: the row has its own. -->
        <SettingsRow
          class="-mt-2"
          :title="__('Send a vacation response')"
          :description="__('People who write to you between these dates get the message below')"
        >
          <Switch v-model="draft.enabled" />
        </SettingsRow>
        <div class="grid gap-4 sm:grid-cols-2">
          <FormControl
            v-model="draft.from_date"
            type="datetime-local"
            :label="__('From date')"
            :disabled="!draft.enabled"
          />
          <FormControl
            v-model="draft.to_date"
            type="datetime-local"
            :label="__('To date')"
            :disabled="!draft.enabled"
          />
        </div>
        <FormControl
          v-model="draft.subject"
          :label="__('Subject')"
          :placeholder="__('Out of office')"
          :disabled="!draft.enabled"
        />
        <div class="flex flex-col gap-1.5">
          <span class="text-sm leading-tighter text-ink-gray-6">{{ __('Message') }}</span>
          <MailRichTextField
            v-model="draft.html_body"
            :placeholder="__('I am away until…')"
            :div-paragraphs="false"
            :editable="draft.enabled"
          />
        </div>
      </SettingsForm>
    </SettingsSection>
    <SetSieveScriptStateModal
      v-model="showConfirmDialog"
      :script="{ _name: 'vacation', active: 0 }"
      :action="submit"
    />
  </SettingsPage>
</template>

<script setup lang="ts">
import { FormControl, SettingsRow, Switch } from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import SetSieveScriptStateModal from '@/apps/mail/components/Modals/SetSieveScriptStateModal.vue'
import { userStore } from '@/apps/mail/stores/user'
import { fromLocalInput, toLocalInput } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import { toast } from '@/platform/feedback'
import { SettingsForm, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const store = userStore()
const draft = reactive({
  enabled: false,
  from_date: '',
  to_date: '',
  subject: '',
  html_body: '',
})
const original = ref('')
const dirty = computed(() => JSON.stringify(draft) !== original.value)

const vacationResponse = useQuery(api.mail.vacation.get, () =>
  store.accountId ? { account: store.accountId } : false,
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
  { immediate: true },
)

// The vacation response is a server-side rule of its own. Turning it on while another rule script
// is active asks first, since only one can run.
const showConfirmDialog = ref(false)
const otherActiveScript = computed(
  () => store.sieveScripts.data?.find((s) => s.active && s._name !== 'vacation')?._name,
)
async function handleSave() {
  if (otherActiveScript.value && draft.enabled) showConfirmDialog.value = true
  else await submit()
}

const update = useMutation(api.mail.vacation.update)
async function submit() {
  await update.run({
    account: store.accountId,
    enabled: draft.enabled,
    from_date: fromLocalInput(draft.from_date),
    to_date: fromLocalInput(draft.to_date),
    subject: draft.subject,
    html_body: draft.html_body,
  })
  await vacationResponse.refetch()
  toast.success(__('Vacation response saved'))
  showConfirmDialog.value = false
}
</script>
