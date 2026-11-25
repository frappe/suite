<template>
  <!-- The password change: a dialog on a computer, a sheet on a phone, as the other forms that open
       over a settings page are. It starts empty each time it opens. -->
  <AdaptiveDialog v-model:open="open" v-bind="dialogOptions">
    <form class="space-y-4" @submit.prevent="changePassword">
      <!-- Capture username here so Chrome doesn't fill profile last name -->
      <input
        type="text"
        name="username"
        autocomplete="username"
        tabindex="-1"
        aria-hidden="true"
        :value="userId"
        readonly
        class="pointer-events-none absolute h-0 w-0 opacity-0"
      />
      <FormControl
        v-model="currentPassword"
        type="password"
        name="current-password"
        autocomplete="current-password"
        :label="__('Current password')"
        variant="outline"
        placeholder="••••••••"
      />
      <FormControl
        v-model="newPassword"
        type="password"
        name="new-password"
        autocomplete="new-password"
        :label="__('New password')"
        variant="outline"
        placeholder="••••••••"
      />
      <FormControl
        v-model="confirmPassword"
        type="password"
        name="confirm-password"
        autocomplete="new-password"
        :label="__('Confirm new password')"
        variant="outline"
        placeholder="••••••••"
      />
      <ErrorMessage :message="passwordError" />
    </form>
  </AdaptiveDialog>
</template>

<script setup lang="ts">
import { ErrorMessage, FormControl, toast } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation } from '@/api'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

const open = defineModel<boolean>('open', { required: true })

const userId = useSession().user.value?.id ?? ''
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const updatePassword = useMutation(api.suite.account.changePassword)
const isSaveBlocked = computed(
  () =>
    !(currentPassword.value.length && newPassword.value.length) ||
    confirmPassword.value !== newPassword.value,
)
const passwordError = computed(() => {
  if (confirmPassword.value && confirmPassword.value !== newPassword.value)
    return __('Passwords do not match')
  const error: unknown = updatePassword.error
  return error instanceof Error ? error : undefined
})

const dialogOptions = computed(() => ({
  title: __('Change password'),
  actions: [
    {
      label: __('Save'),
      variant: 'solid' as const,
      onClick: () => changePassword(),
      disabled: isSaveBlocked.value,
      loading: updatePassword.isPending,
    },
  ],
}))

async function changePassword() {
  if (isSaveBlocked.value) return
  await updatePassword.run({
    old_password: currentPassword.value,
    new_password: newPassword.value,
  })
  open.value = false
  toast.success(__('Password updated'))
}

watch(open, (isOpen) => {
  if (isOpen) return
  currentPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  updatePassword.reset()
})
</script>
