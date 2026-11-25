<template>
  <div v-if="vacationResponse.data" class="flex flex-col gap-5">
    <SettingsRow
      class="!py-0"
      :title="__('Send an auto-reply')"
      :description="__('Reply to incoming mail while you’re away.')"
    >
      <Switch v-model="draft.enabled" />
    </SettingsRow>
    <!-- Off, the reply's fields stay where they are, disabled, so the dialog keeps its size and
         the switch stays under the pointer -->
    <div class="grid gap-4 sm:grid-cols-2">
      <FormControl
        v-model="draft.from_date"
        type="datetime"
        :label="__('Starts')"
        :format="SHOWN_FORMAT"
        :placeholder="__('Now')"
        variant="outline"
        :disabled="isOff"
      />
      <FormControl
        v-model="draft.to_date"
        type="datetime"
        :label="__('Ends')"
        :format="SHOWN_FORMAT"
        :placeholder="__('Until you turn it off')"
        variant="outline"
        :disabled="isOff"
      />
    </div>
    <FormControl
      v-model="draft.subject"
      :label="__('Subject')"
      :placeholder="__('Out of office')"
      variant="outline"
      :disabled="isOff"
    />
    <div class="space-y-1.5">
      <FormLabel :label="__('Message')" />
      <MailRichTextField
        v-model="draft.html_body"
        :placeholder="__('Write your reply…')"
        :div-paragraphs="false"
        :disabled="isOff"
      />
    </div>
    <ErrorMessage :message="saveError" />
    <SettingsDialogActions>
      <Button
        :label="__('Save')"
        variant="solid"
        :size="buttonSize"
        :disabled="isSaveBlocked"
        :loading="updateVacationResponse.isPending"
        @click="updateVacationResponseSubmit"
      />
    </SettingsDialogActions>
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, FormLabel, SettingsRow, Switch } from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import MailRichTextField from '@/apps/mail/components/Controls/MailRichTextField.vue'
import { userStore } from '@/apps/mail/stores/user'
import { raiseToast } from '@/apps/mail/utils'
import { useScreenSize } from '@/apps/mail/utils/composables'
import { fromLocalInput, inUserTimeZone } from '@/apps/mail/utils/datetime'
import dayjs from '@/apps/mail/utils/dayjs'
import { failureLine } from '@/platform/feedback'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import { translate as __ } from '@/platform/translation'

const emit = defineEmits<{ saved: [] }>()

const store = userStore()
const { isMobile } = useScreenSize()
const buttonSize = computed(() => (isMobile.value ? 'md' : 'sm'))
// What a date and time field reads and writes: a clock reading in the user's zone, naming no
// zone. The field keeps time to the minute, so a saved time is read to the minute, or the field
// would hand back another time the first time it is left
const FIELD_FORMAT = 'YYYY-MM-DD HH:mm[:00]'
// How the field shows the time it holds: on the 24-hour clock, as the time box in its calendar does
const SHOWN_FORMAT = 'D MMM YYYY, HH:mm'
function toField(value?: string | null) {
  if (!value) {
    return ''
  }

  return inUserTimeZone(value).format(FIELD_FORMAT)
}

const draft = reactive({
  enabled: false,
  from_date: '',
  to_date: '',
  subject: '',
  html_body: '',
})
const isOff = computed(() => !draft.enabled)
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
      from_date: toField(data.from_date),
      to_date: toField(data.to_date),
      subject: data.subject ?? '',
      html_body: data.html_body ?? '',
    })
    // An absence that is off and over is history, not a default: its dates go, so turning the
    // responder on again starts from nothing rather than last year's trip. Its words stay, to reuse
    const over = !data.enabled && !!data.to_date && dayjs.utc(data.to_date).isBefore(dayjs())
    if (over) {
      draft.from_date = ''
      draft.to_date = ''
    }

    original.value = JSON.stringify(draft)
  },
  {
    immediate: true,
  },
)
// Words a reply goes out with: a body with neither text nor an image is none, and would send a
// blank reply
function hasWords(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body
  return !!body.textContent?.trim() || !!body.querySelector('img')
}
// Nothing to save until the form differs from the reply as it was read, nor a reply turned on
// with nothing to say
const isSaveBlocked = computed(
  () =>
    vacationResponse.isFetching ||
    JSON.stringify(draft) === original.value ||
    (draft.enabled && !hasWords(draft.html_body)),
)
// A refused save is said on the form, where the eyes are, so no toast says it too
const updateVacationResponse = useMutation(api.mail.vacation.update, { silent: true })
const saveError = computed(() => failureLine(updateVacationResponse.error))
async function updateVacationResponseSubmit() {
  const input: InputOf<typeof api.mail.vacation.update> = {
    account: store.accountId,
    enabled: draft.enabled,
    from_date: fromLocalInput(draft.from_date),
    to_date: fromLocalInput(draft.to_date),
    // A reply goes out with a subject: left empty, the one its field suggests
    subject: draft.subject.trim() || __('Out of office'),
    html_body: draft.html_body,
  }
  await updateVacationResponse.run(input)

  await vacationResponse.refetch()
  raiseToast(__('Auto-reply updated'))
  emit('saved')
}
</script>
