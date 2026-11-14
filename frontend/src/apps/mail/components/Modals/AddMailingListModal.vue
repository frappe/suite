<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add mailing list'),
      actions: [
        {
          label: __('Add mailing list'),
          variant: 'solid' as const,
          disabled: !(name && domain) || !recipients.every(isEmail),
          loading: addList.isPending,
          onClick: addListSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <EmailAddressField
          v-model:username="name"
          v-model:domain="domain"
          :domains="domains.data ?? []"
          username-placeholder="announce"
          :description="__('Mail sent to this address goes to every recipient on the list.')"
        />
        <FormControl v-model="description" :label="__('Description')" />
        <EmailListInput
          v-model="recipients"
          v-model:draft="recipientDraft"
          :label="__('Recipients')"
          :placeholder="__('Type or paste email addresses')"
        />
        <ErrorMessage
          :message="
            domainsError ||
            (addList.error &&
              (addList.error?.messages?.[0] || addList.error?.message || __('Request failed.')))
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, type InputOf } from '@/api'
import EmailAddressField from '@/apps/mail/components/Controls/EmailAddressField.vue'
import EmailListInput from '@/apps/mail/components/Controls/EmailListInput.vue'
import { useEnabledDomains } from '@/apps/mail/composables/useEnabledDomains'
import { isEmail, raiseToast } from '@/apps/mail/utils'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const name = ref('')
const domain = ref('')
const description = ref('')
const recipients = ref<string[]>([])
const recipientDraft = ref('')

const { domains, domainsError } = useEnabledDomains(show)

watch(show, () => {
  if (show.value) {
    name.value = ''
    domain.value = ''
    description.value = ''
    recipients.value = []
    recipientDraft.value = ''
    addList.reset()
  }
})

// The dialog's ErrorMessage reports a refusal; a toast on top would say it twice.
const addList = useMutation(api.mail.admin.mailingLists.create, { silent: true })
async function addListSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.create> = {
    name: name.value,
    domain: domain.value,
    description: description.value?.trim() || undefined,
    recipients: recipients.value,
  }

  const result = await addList.run(input)
  const data = result

  if (!data) return
  show.value = false
  emit('reload')
  raiseToast(__('Mailing list added'))
  router.push({ name: 'mail-mailing-list', params: { listId: data } })
}
</script>
