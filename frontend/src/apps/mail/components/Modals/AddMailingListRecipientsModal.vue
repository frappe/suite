<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add recipients'),
      actions: [
        {
          label: __('Add'),
          variant: 'solid' as const,
          disabled: !(emails.length || draft.trim()) || !emails.every(isEmail),
          loading: addRecipients.isPending,
          onClick: addRecipientsSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <EmailListInput
          v-model="emails"
          v-model:draft="draft"
          :label="__('Recipients')"
          :placeholder="__('Type or paste email addresses')"
          :description="__('Separate addresses with a comma, a space or a new line.')"
        />
        <ErrorMessage
          :message="
            addRecipients.error &&
            (addRecipients.error?.messages?.[0] ||
              addRecipients.error?.message ||
              __('Request failed.'))
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage } from 'frappe-ui'
import { ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import EmailListInput from '@/apps/mail/components/Controls/EmailListInput.vue'
import { isEmail, raiseToast } from '@/apps/mail/utils'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()
const { listId } = defineProps<{
  listId: string
}>()
const emit = defineEmits(['reload'])
const emails = ref<string[]>([])
const draft = ref('')
watch(show, () => {
  if (show.value) {
    emails.value = []
    draft.value = ''
    addRecipients.reset()
  }
})
const addRecipients = useMutation(api.mail.admin.mailingLists.addRecipients)
async function addRecipientsSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.addRecipients> = {
    list_id: listId,
    recipients: emails.value,
  }
  await addRecipients.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Recipients added'))
}
</script>
