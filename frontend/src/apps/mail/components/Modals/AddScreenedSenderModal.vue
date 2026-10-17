<template>
  <Dialog
    v-model:open="show"
    v-bind="{
      title: __('Screen a Sender'),
      actions: [
        {
          label: __('Add'),
          variant: 'solid' as const,
          disabled: !canAdd,
          loading: screenEmailAddress.isPending,
          onClick: screenEmailAddressSubmit,
        },
      ],
    }"
  >
    <template #default>
      <div class="space-y-4">
        <FormControl
          v-model="email"
          type="text"
          variant="outline"
          :label="__('Email or Domain')"
          :placeholder="__('john@example.com or @example.com')"
          @keydown.enter="canAdd && screenEmailAddressSubmit()"
        />
        <FormControl
          v-model="action"
          type="select"
          variant="outline"
          :label="__('Action')"
          :options="ACTION_OPTIONS"
        />
        <p v-if="isAlreadyScreened" class="text-ink-gray-5 text-xs">
          {{ __('This sender is already screened.') }}
        </p>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, type InputOf } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import type { ScreenedAddress, ScreeningAction } from '@/apps/mail/types'
import { isEmailOrDomain, raiseToast } from '@/apps/mail/utils'

const show = defineModel<boolean>()
const store = userStore()
const { screenedAddresses } = store
const email = ref('')
const action = ref<ScreeningAction>('Spam')

// 'Accepted' lets the sender's mail reach the inbox; 'Spam' blocks them, filing it into Junk.
const ACTION_OPTIONS = [
  {
    label: __('Accept'),
    value: 'Accepted',
  },
  {
    label: __('Block'),
    value: 'Spam',
  },
]

// Mirror the backend's normalisation (trim; lowercase a '@domain' entry) so '@Frappe.io' is caught as
// a duplicate of a stored '@frappe.io'.
const normalizeScreenedValue = (value: string) => {
  const trimmed = value.trim()
  return trimmed.startsWith('@') ? '@' + trimmed.slice(1).toLowerCase() : trimmed
}
const isAlreadyScreened = computed(() =>
  (screenedAddresses.data ?? []).some(
    (a: ScreenedAddress) => a.email === normalizeScreenedValue(email.value),
  ),
)
const canAdd = computed(() => isEmailOrDomain(email.value) && !isAlreadyScreened.value)
const screenEmailAddress = useMutation(api.mail.screening.setAddress)
async function screenEmailAddressSubmit() {
  const input: InputOf<typeof api.mail.screening.setAddress> = {
    account: store.accountId,
    email: email.value,
    action: action.value,
  }
  await screenEmailAddress.run(input)
  raiseToast(__('Sender screened.'))
  show.value = false
}

// Start each visit from a clean form.
watch(show, (open) => {
  if (open) {
    email.value = ''
    action.value = 'Spam'
  }
})
</script>
