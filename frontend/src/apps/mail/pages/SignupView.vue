<template>
  <form class="flex flex-col space-y-4" @submit.prevent="next().catch(() => {})">
    <div v-if="route.query.step === '1'" class="flex items-center justify-between">
      <FormControl
        v-model="user.username"
        :label="__('Username')"
        placeholder="johndoe"
        autocomplete="username"
        class="w-full"
        required
        @update:model-value="usernameVerified = false"
      />
      <FeatherIcon class="text-ink-gray-3 mx-2.5 mb-1.5 mt-auto h-4 w-4" name="at-sign" />
      <FormControl
        v-if="signupDomains?.data?.length"
        v-model="user.domain"
        :type="signupDomains?.data?.length === 1 ? 'text' : 'select'"
        :readonly="signupDomains?.data?.length === 1"
        :options="signupDomains?.data"
        :label="__('Domain Name')"
        class="w-full"
        required
        @update:model-value="usernameVerified = false"
      />
    </div>

    <FormControl
      v-else-if="route.query.step === '2'"
      v-model="user.email"
      type="email"
      :label="__('Backup Email')"
      placeholder="johndoe@personal.com"
      autocomplete="email"
      class="w-full"
      required
    />

    <FormControl
      v-else-if="route.query.step === '3'"
      v-model="user.password"
      type="password"
      :label="__('Password')"
      placeholder="*********"
      autocomplete="new-password"
      class="w-full"
      required
    />

    <template v-else-if="route.query.step === '4'">
      <FormControl
        v-model="otp"
        :label="__('Verification Code')"
        :description="__('Enter the code sent to {0}.', [user.email])"
        placeholder="123456"
        autocomplete="one-time-code"
        class="w-full"
        required
      />
      <button
        class="text-left text-base text-ink-gray-6 hover:underline"
        type="button"
        :disabled="resendOtp.isPending"
        @click="resendOtp.run({ account_request: accountRequest }).catch(() => {})"
      >
        {{ __('Resend code') }}
      </button>
    </template>

    <template v-else>
      <FormControl
        v-model="user.first_name"
        :label="__('First Name')"
        placeholder="John"
        autocomplete="given-name"
        class="w-full"
        required
      />
      <FormControl
        v-model="user.last_name"
        :label="__('Last Name')"
        placeholder="Doe"
        autocomplete="family-name"
        class="w-full"
      />
    </template>

    <ErrorMessage :message="errorMessage" />
    <Button
      variant="solid"
      :label="
        route.query.step === '4'
          ? __('Verify')
          : route.query.step === '3'
            ? __('Sign Up')
            : __('Next')
      "
      :loading="
        validateUsername.isFetching ||
        signup.isPending ||
        verifyOtp.isPending ||
        createAccount.isPending ||
        session.isLoggingIn
      "
      type="submit"
    />
    <Button
      v-if="route.query.step"
      :label="__('Back')"
      @click.prevent="router.push({ query: { step: Number(route.query.step) - 1 } })"
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
import { Icon as FeatherIcon } from 'frappe-ui/experimental'
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { sessionStore } from '@/apps/mail/stores/session'

const router = useRouter()
const route = useRoute()
const session = sessionStore()
const { login } = session

const usernameVerified = ref(false)
const accountRequest = ref('')
const otp = ref('')

const user = reactive({
  first_name: '',
  last_name: '',
  username: '',
  domain: '',
  email: '',
  password: '',
})

const settings = useQuery(api.mail.public.signupSettings)
watch(
  () => settings.data,
  (data) => {
    if (data && !data.allow_signup) router.replace({ name: 'mail-login' })
  },
)
const signupDomains = useQuery(api.mail.public.signupDomains)
watch(
  () => signupDomains.data,
  (domains) => {
    if (domains?.length && !domains.includes(user.domain)) user.domain = domains[0]
  },
)
const validationInput = ref<InputOf<typeof api.mail.public.checkEmail> | false>(false)
const validateUsername = useQuery(api.mail.public.checkEmail, validationInput)
const signup = useMutation(api.mail.public.signup, { silent: true })
const resendOtp = useMutation(api.mail.public.resendCode, { silent: true })
const verifyOtp = useMutation(api.mail.public.verifyCode, { silent: true })
const createAccount = useMutation(api.mail.public.createAccount, { silent: true })
const errorMessage = computed(
  () =>
    validateUsername.error?.message ||
    signup.error?.message ||
    verifyOtp.error?.message ||
    createAccount.error?.message ||
    resendOtp.error?.message ||
    session.loginError?.message,
)

async function next() {
  if (route.query.step === '1') {
    validationInput.value = { email: `${user.username}@${user.domain}` }
    await validateUsername.refetch()
    usernameVerified.value = true
    await router.push({ query: { step: '2' } })
  } else if (route.query.step === '3') {
    accountRequest.value = await signup.run({
      username: user.username,
      domain: user.domain,
      email: user.email,
    })
    await router.push({ query: { step: '4' } })
  } else if (route.query.step === '4') {
    const requestKey = await verifyOtp.run({
      account_request: accountRequest.value,
      otp: otp.value,
    })
    await createAccount.run({
      request_key: requestKey,
      first_name: user.first_name,
      last_name: user.last_name,
      password: user.password,
    })
    await login(`${user.username}@${user.domain}`, user.password)
  } else {
    await router.push({ query: { step: Number(route.query.step || 0) + 1 } })
  }
}

watch(
  () => route.query.step,
  (step) => {
    switch (step) {
      case '4':
        if (!accountRequest.value) {
          router.replace({ query: { step: '3' } })
          break
        }
      // fallthrough
      case '3':
        if (!user.email) {
          router.replace({ query: { step: '2' } })
          break
        }
      // fallthrough
      case '2':
        if (!usernameVerified.value) {
          router.replace({ query: { step: '1' } })
          break
        }
      // fallthrough
      case '1':
        if (!user.first_name) {
          router.replace({ query: {} })
        }
        break
      default:
        router.replace({ query: {} })
    }
  },
  { immediate: true },
)
</script>
