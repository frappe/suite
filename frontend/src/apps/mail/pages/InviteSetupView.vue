<template>
  <form class="flex flex-col space-y-4" @submit.prevent="submit().catch(() => {})">
    <FormControl
      v-model="email"
      :label="__('Email')"
      type="email"
      placeholder="johndoe@example.com"
      autocomplete="email"
      readonly
      required
    />
    <FormControl
      v-model="firstName"
      :label="__('First Name')"
      placeholder="John"
      autocomplete="given-name"
      required
    />
    <FormControl
      v-model="lastName"
      :label="__('Last Name')"
      placeholder="Doe"
      autocomplete="family-name"
    />
    <FormControl
      v-model="password"
      :label="__('Password')"
      type="password"
      placeholder="••••••••"
      name="password"
      autocomplete="current-password"
      required
    />
    <ErrorMessage :message="errorMessage" />
    <Button
      variant="solid"
      :loading="createAccount.isPending || session.isLoggingIn"
      :label="__('Create Account')"
      type="submit"
    />
  </form>
  <div class="mt-6 text-center">
    <router-link class="text-center text-base-medium hover:underline" :to="{ name: 'mail-login' }">
      {{ __('Already have an account? Log in.') }}
    </router-link>
  </div>
</template>
<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { api, useMutation, useQuery } from '@/api'
import { sessionStore } from '@/apps/mail/stores/session'
import { accountDefaults } from '@/apps/mail/utils/accountDefaults'

const { requestKey } = defineProps<{ requestKey: string }>()

const router = useRouter()
const session = sessionStore()
const { login } = session

const email = ref('')
const firstName = ref('')
const lastName = ref('')
const password = ref('')
const completingSetup = ref(false)
const getAccountRequest = useQuery(api.mail.public.accountRequest, () =>
  requestKey.length === 32 ? { request_key: requestKey } : false,
)
const pendingRequest = computed(() => {
  const data = getAccountRequest.data
  return data && (data.backup_email || data.account) && !data.is_verified && !data.is_expired
    ? data
    : undefined
})
watch(
  () => requestKey,
  (key) => {
    if (key && key.length !== 32) router.replace({ name: 'mail-signup' })
  },
  { immediate: true },
)
watch(
  () => getAccountRequest.status,
  (status) => {
    if (status === 'success' && !pendingRequest.value && !completingSetup.value)
      router.replace({ name: 'mail-signup' })
  },
)
watch(pendingRequest, (data) => {
  if (data) email.value = data.account || data.backup_email || ''
})
const accountOptions = useQuery(api.mail.public.accountOptions, () =>
  pendingRequest.value ? { request_key: requestKey } : false,
)
const createAccount = useMutation(api.mail.public.createAccount, { silent: true })
const errorMessage = computed(
  () =>
    createAccount.error?.message ||
    getAccountRequest.error?.message ||
    accountOptions.error?.message ||
    session.loginError?.message,
)
async function submit() {
  completingSetup.value = true
  try {
    await createAccount.run({
      request_key: requestKey,
      first_name: firstName.value,
      last_name: lastName.value,
      password: password.value,
      ...accountDefaults(accountOptions.data),
    })
    await login(email.value, password.value)
  } finally {
    completingSetup.value = false
  }
}
</script>
