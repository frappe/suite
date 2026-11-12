<!--
  A person with a temporary password chooses their own, and may add a backup
  email for resets. Right after signing in, the temporary password is still in
  memory and is not asked for; after a reload it is.
-->
<script setup lang="ts">
import { ErrorMessage, FormControl } from 'frappe-ui'
import { computed, reactive } from 'vue'

import { api, client, useMutation } from '@/api'
import { toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'

import { isEmail } from './onboarding'

const { temporaryPassword } = defineProps<{ temporaryPassword: string }>()
const emit = defineEmits<{ saved: [] }>()

const session = useSession()
const passwordForm = reactive({ temporary: '', password: '', backupEmail: '' })
const needsTemporary = computed(() => !temporaryPassword)
const canSubmit = computed(
  () =>
    passwordForm.password.length >= 8 &&
    (!needsTemporary.value || !!passwordForm.temporary) &&
    (!passwordForm.backupEmail.trim() || isEmail(passwordForm.backupEmail)),
)
const changePassword = useMutation(api.suite.account.changePassword, { silent: true })
const saveCredentials = useMutation(api.mail.settings.updateCredentials, { silent: true })

async function submit(): Promise<void> {
  await changePassword.run({
    old_password: temporaryPassword || passwordForm.temporary,
    new_password: passwordForm.password,
  })
  passwordForm.temporary = passwordForm.password = ''
  await session.refresh()
  const backupEmail = passwordForm.backupEmail.trim()
  if (backupEmail) {
    try {
      const credentials = await client.query(api.mail.settings.credentials)
      await saveCredentials.run({ username: credentials.username, backup_email: backupEmail })
    } catch {
      toast.error(__('Your password is saved, but the backup email is not. Add it in Settings.'))
    }
  }
  emit('saved')
}

defineExpose({
  canSubmit,
  /** Whether the password change itself is in flight; the backup email comes after it. */
  changing: computed(() => changePassword.isPending),
  working: computed(() => changePassword.isPending || saveCredentials.isPending),
  submit,
})
</script>

<template>
  <form class="flex flex-col gap-4" @submit.prevent="canSubmit && submit()">
    <FormControl
      v-if="needsTemporary"
      v-model="passwordForm.temporary"
      type="password"
      variant="outline"
      :label="__('Temporary password')"
      autocomplete="current-password"
    />
    <FormControl
      v-model="passwordForm.password"
      type="password"
      variant="outline"
      :label="__('New password')"
      autocomplete="new-password"
      :description="__('At least 8 characters. Your temporary password stops working.')"
    />
    <FormControl
      v-model="passwordForm.backupEmail"
      type="email"
      variant="outline"
      :label="__('Backup email (optional)')"
      :placeholder="'you@gmail.com'"
      :description="
        __(
          'Where we send a reset link if you forget it. Without one, your Admin has to reset it for you.',
        )
      "
    />
    <ErrorMessage :message="changePassword.error?.message" />
    <button type="submit" class="hidden" tabindex="-1" aria-hidden="true" />
  </form>
</template>
