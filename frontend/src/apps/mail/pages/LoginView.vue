<template>
  <form class="flex flex-col space-y-4" @submit.prevent="login.submit({ usr, pwd })">
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
    <ErrorMessage :message="login.error" />
    <Button variant="solid" :loading="login.loading" :label="__('Log In')" type="submit" />
  </form>
  <div v-if="Number(signupSettings.data?.allow_signup)" class="mt-6 text-center">
    <router-link class="text-center text-base-medium hover:underline" :to="{ name: 'mail-signup' }">
      {{ __('New member? Create an account.') }}
    </router-link>
  </div>
</template>
<script setup lang="ts">
import { Button, createResource, ErrorMessage, FormControl } from 'frappe-ui'
import { ref } from 'vue'

import { sessionStore } from '@/apps/mail/stores/session'

const { login } = sessionStore()

const usr = ref('')
const pwd = ref('')

const signupSettings = createResource({ url: 'suite.mail.api.get_signup_settings', auto: true })
</script>
