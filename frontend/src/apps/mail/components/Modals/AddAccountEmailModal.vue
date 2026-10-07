<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Add Email Address'),
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
        <div class="flex items-center justify-between">
          <FormControl
            v-model="username"
            :label="__('Username')"
            placeholder="johndoe"
            class="w-full"
          />
          <FeatherIcon class="text-ink-gray-3 mx-2.5 mb-1.5 mt-auto h-4 w-4" name="at-sign" />
          <FormControl
            v-model="domain"
            type="combobox"
            :label="__('Domain')"
            placeholder="yourdomain.com"
            class="w-full"
            :options="domains.data"
            :open-on-click="true"
          />
        </div>
        <p class="text-ink-gray-4 -mt-2 text-xs">
          {{ __("Mail sent to this address is delivered to this account's mailbox.") }}
        </p>
        <FormControl
          v-model="description"
          :label="__('Full Name')"
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
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { useEnabledDomains } from '@/apps/mail/composables/useEnabledDomains'
import { raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const { memberId } = defineProps<{
  memberId: string
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
const addEmail = useMutation(api.mail.admin.members.addEmail)
async function addEmailSubmit() {
  const input: InputOf<typeof api.mail.admin.members.addEmail> = {
    member_id: memberId,
    email: `${username.value}@${domain.value}`,
    description: description.value?.trim() || undefined,
  }
  await addEmail.run(input)
  show.value = false
  emit('reload')
  raiseToast(__('Email address added.'))
}
</script>
