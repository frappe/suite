<template>
  <form class="flex flex-col space-y-4" @submit.prevent="submit">
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
    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs">{{ __('Locale') }}</label>
      <Combobox v-model="locale" :options="localeOptions" :placeholder="__('Select a locale')" />
    </div>
    <div class="space-y-1.5">
      <label class="text-ink-gray-5 block text-xs">{{ __('Time Zone') }}</label>
      <Combobox
        v-model="timeZone"
        :options="timeZoneOptions"
        :placeholder="__('Select a time zone')"
      />
    </div>
    <ErrorMessage :message="errorMessage" />
    <Button
      variant="solid"
      :loading="createAccount.loading"
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
import { Button, Combobox, createResource, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { sessionStore } from '@/apps/mail/stores/session'

const { requestKey } = defineProps<{ requestKey: string }>()

const router = useRouter()
const { login } = sessionStore()

type Option = { value: string; label: string }

const email = ref('')
const firstName = ref('')
const lastName = ref('')
const password = ref('')
const locale = ref('')
const timeZone = ref('')
const errorMessage = ref('')

const getAccountRequest = createResource({
  url: 'suite.mail.api.account.get_account_request',
  makeParams: () => ({ request_key: requestKey }),
  onSuccess: (data) => {
    if ((data?.backup_email || data?.account) && !data?.is_verified && !data?.is_expired) {
      email.value = data.account || data.backup_email
      accountOptions.submit()
    } else router.replace({ name: 'mail-signup' })
  },
})

// Fetched only once the request is known to be pending, since the endpoint is gated on that too.
const accountOptions = createResource({
  url: 'suite.mail.api.account.get_account_setup_options',
  makeParams: () => ({ request_key: requestKey }),
})

const localeOptions = computed<Option[]>(() => accountOptions.data?.locales || [])
// The time zone is optional, so it needs a blank choice to leave it unset.
const timeZoneOptions = computed<Option[]>(() => [
  { value: '', label: __('Not set') },
  ...(accountOptions.data?.time_zones || []),
])

const createAccount = createResource({
  url: 'suite.mail.api.account.create_account',
  makeParams: () => ({
    request_key: requestKey,
    first_name: firstName.value,
    last_name: lastName.value,
    password: password.value,
    // Blank means "server default" for both, which the API spells as null.
    locale: locale.value || null,
    time_zone: timeZone.value || null,
  }),
  onSuccess: () => {
    errorMessage.value = ''
    login.submit({ usr: email.value, pwd: password.value })
  },
  onError: (error) => (errorMessage.value = error.messages[0]),
})

watch(
  () => requestKey,
  (val) => {
    if (!val) return
    if (val.length === 32) getAccountRequest.submit()
    else router.replace({ name: 'mail-signup' })
  },
  { immediate: true },
)

const submit = () => createAccount.submit()
</script>
