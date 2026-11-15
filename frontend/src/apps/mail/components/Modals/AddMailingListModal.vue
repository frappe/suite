<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add mailing list'),
      actions: [
        {
          label: __('Add mailing list'),
          variant: 'solid' as const,
          disabled: !(name && domain),
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
        <FormControl
          v-model="recipients"
          :label="__('Recipients')"
          type="textarea"
          :placeholder="__('One email address per line')"
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
import { useEnabledDomains } from '@/apps/mail/composables/useEnabledDomains'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const router = useRouter()
const emit = defineEmits(['reload'])

const name = ref('')
const domain = ref('')
const description = ref('')
const recipients = ref('')

const { domains, domainsError } = useEnabledDomains(show)

const toLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

watch(show, () => {
  if (show.value) {
    name.value = ''
    domain.value = ''
    description.value = ''
    recipients.value = ''
    addList.reset()
  }
})

const addList = useMutation(api.mail.admin.mailingLists.create)
async function addListSubmit() {
  const input: InputOf<typeof api.mail.admin.mailingLists.create> = {
    name: name.value,
    domain: domain.value,
    description: description.value?.trim() || undefined,
    recipients: toLines(recipients.value),
  }

  const result = await addList.run(input)
  const data = result

  if (!data) return
  show.value = false
  emit('reload')
  raiseToast(__('Mailing list added.'))
  router.push({ name: 'mail-mailing-list', params: { listId: data } })
}
</script>
