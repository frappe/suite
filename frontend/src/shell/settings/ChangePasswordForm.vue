<template>
  <!-- The password change, as a part of the profile's page (see SettingsDialogRow): a dialog on a
       computer, a page of its own on a phone, where a sheet would sit under the keyboard. It is
       built each time it opens, so it starts empty. -->
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
  <SettingsDialogActions>
    <Button
      :label="__('Save')"
      variant="solid"
      :size="phonePage ? 'md' : 'sm'"
      :disabled="isSaveBlocked"
      :loading="updatePassword.isPending"
      @click="changePassword"
    />
  </SettingsDialogActions>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl, toast } from 'frappe-ui'
import { computed, inject, ref } from 'vue'

import { api, useMutation } from '@/api'
import { useSession } from '@/platform/session'
import SettingsDialogActions from '@/platform/settings/SettingsDialogActions.vue'
import { translate as __ } from '@/platform/translation'
import { SETTINGS_PHONE_PAGE } from '@/shell/settings/settings'

const emit = defineEmits<{ saved: [] }>()

const phonePage = inject(SETTINGS_PHONE_PAGE, false)
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

async function changePassword() {
  if (isSaveBlocked.value) return
  await updatePassword.run({
    old_password: currentPassword.value,
    new_password: newPassword.value,
  })
  emit('saved')
  toast.success(__('Password updated'))
}
</script>
