<template>
  <form class="flex flex-col space-y-4" @submit.prevent="login(usr, pwd).catch(() => {})">
    <FormControl
      v-model="usr"
      :label="__('Email')"
      placeholder="johndoe@example.com"
      autocomplete="email"
      required
    />
    <FormControl
      v-model="pwd"
      :label="__('Password')"
      type="password"
      placeholder="••••••••"
      name="password"
      autocomplete="current-password"
      required
    />
    <div clas="!mt-2">
      <router-link class="text-sm hover:underline" :to="{ name: 'mail-forgot-password' }">
        {{ __('Forgot password?') }}
      </router-link>
    </div>
    <ErrorMessage :message="loginError?.message" />
    <Button variant="solid" :loading="isLoggingIn" :label="__('Log In')" type="submit" />
  </form>
  <div v-if="Number(signupSettings.data?.allow_signup)" class="mt-6 text-center">
    <router-link class="text-center text-base-medium hover:underline" :to="{ name: 'mail-signup' }">
      {{ __('New member? Create an account.') }}
    </router-link>
  </div>
</template>
<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { storeToRefs } from 'pinia'
import { ref } from 'vue'

import { api, useQuery } from '@/api'
import { sessionStore } from '@/apps/mail/stores/session'

const session = sessionStore()
const { login } = session
const { isLoggingIn, loginError } = storeToRefs(session)

const usr = ref('')
const pwd = ref('')

const signupSettings = useQuery(api.mail.public.signupSettings)
</script>
