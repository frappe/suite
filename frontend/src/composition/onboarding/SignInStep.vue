<!--
  Signing in with the temporary password an Admin gave. It reports the password
  that worked, so the next step can replace it without asking again.
-->
<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { reactive, ref } from 'vue'

import { useSession } from '@/platform/session'

import { isEmail } from './onboarding'

const { email = '' } = defineProps<{ email?: string }>()
const emit = defineEmits<{ 'signed-in': [temporaryPassword: string] }>()

const session = useSession()
const signin = reactive({ email, password: '' })
const signingIn = ref(false)
const signinError = ref('')

async function submit(): Promise<void> {
  signingIn.value = true
  signinError.value = ''
  try {
    await session.login(signin.email.trim(), signin.password)
  } catch (error) {
    signinError.value = error instanceof Error ? error.message : String(error)
    return
  } finally {
    signingIn.value = false
  }
  const temporaryPassword = signin.password
  signin.password = ''
  emit('signed-in', temporaryPassword)
}
</script>

<template>
  <form class="flex w-full flex-col gap-4" @submit.prevent="submit">
    <FormControl
      v-model="signin.email"
      type="email"
      variant="outline"
      :label="__('Email')"
      autocomplete="username"
      :autofocus="!signin.email"
    />
    <FormControl
      v-model="signin.password"
      type="password"
      variant="outline"
      :label="__('Password')"
      autocomplete="current-password"
      :autofocus="!!signin.email"
    />
    <ErrorMessage :message="signinError" />
    <Button
      class="mt-2 w-full"
      type="submit"
      variant="solid"
      size="md"
      :label="__('Sign in')"
      :loading="signingIn"
      :disabled="!isEmail(signin.email) || !signin.password"
    />
    <p class="text-center text-sm text-ink-gray-5">
      {{ __('Lost it? Ask your Admin for a new temporary password.') }}
    </p>
  </form>
</template>
