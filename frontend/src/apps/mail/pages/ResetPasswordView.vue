<template>
  <form class="flex flex-col space-y-4" @submit.prevent="reset()">
    <FormControl
      :label="__('Email')"
      :value="user.data ?? ''"
      autocomplete="email"
      readonly
      required
    />
    <FormControl
      v-model="password"
      :label="__('New Password')"
      type="password"
      placeholder="••••••••"
      name="password"
      autocomplete="new-password"
      required
    />
    <ErrorMessage :message="resetPassword.error?.message" />
    <Button
      variant="solid"
      :loading="resetPassword.isPending"
      :label="__('Confirm')"
      type="submit"
    />
  </form>
</template>
<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery } from '@/api'

const { requestKey } = defineProps<{ requestKey: string }>()

const router = useRouter()

const password = ref('')

const user = useQuery(api.mail.public.resetAccount, () => ({ key: requestKey }))
watch(
  () => [user.status, user.data],
  () => {
    if (user.status === 'error' || (user.status === 'success' && !user.data))
      router.replace({ name: 'mail-forgot-password' })
  },
)
const resetPassword = useMutation(api.suite.account.resetPassword, { silent: true })
async function reset() {
  await resetPassword.run({ key: requestKey, new_password: password.value })
  window.location.reload()
}
</script>
