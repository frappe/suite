<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add email address'),
      actions: [
        {
          label: __('Add'),
          variant: 'solid' as const,
          disabled: !(username && domain),
          loading: addEmail.isPending,
          onClick: addEmailSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <EmailAddressField
          v-model:username="username"
          v-model:domain="domain"
          :domains="domains.data ?? []"
          username-placeholder="announce"
          :description="__('Mail sent to this address is distributed to the list\'s recipients.')"
        />
        <FormControl
          v-model="description"
          :label="__('Description')"
          :placeholder="__('Used as the display name for this address')"
        />
        <ErrorMessage
          :message="
            domainsError ||
            (addEmail.error &&
              (addEmail.error?.messages?.[0] || addEmail.error?.message || __('Request failed.')))
          "
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, FormControl } from 'frappe-ui'
import { ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import EmailAddressField from '@/apps/mail/components/Controls/EmailAddressField.vue'
import { useEnabledDomains } from '@/apps/mail/composables/useEnabledDomains'
import { raiseToast } from '@/apps/mail/utils'
import { translate as __ } from '@/platform/translation'

const show = defineModel<boolean>()
const { listId } = defineProps<{
  listId: string
}>()
const emit = defineEmits(['reload'])
const username = ref('')
const domain = ref('')
const description = ref('')
const { domains, domainsError } = useEnabledDomains(show)
watch(show, () => {
  if (show.value) {
    username.value = ''
    domain.value = ''
    description.value = ''
    addEmail.reset()
  }
})
const addEmail = useMutation(api.mail.admin.mailingLists.addEmail)
async function addEmailSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.addEmail> = {
    list_id: listId,
    email: `${username.value}@${domain.value}`,
    description: description.value?.trim() || undefined,
  }
  await addEmail.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Email address added'))
}
</script>
