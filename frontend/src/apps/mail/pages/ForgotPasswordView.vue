<template>
  <p v-if="sent" class="text-p-base text-ink-gray-8">
    {{
      __(
        'If an account exists for that address, we sent a reset link. Click the link in the email to reset your password.',
      )
    }}
  </p>

  <form v-else class="flex flex-col space-y-4" @submit.prevent="send()">
    <Alert
      v-if="linkFailed"
      theme="red"
      :title="__('This reset link has expired or does not work')"
      :description="__('Enter your email to get a new one.')"
      :dismissable="false"
    />
    <FormControl
      v-model="email"
      :label="__('Email')"
      placeholder="johndoe@example.com"
      autocomplete="email"
      required
    />
    <ErrorMessage :message="sendResetLink.error?.message" />
    <Button variant="solid" :loading="sendResetLink.isPending" type="submit">
      {{ __('Send Reset Link') }}
    </Button>
  </form>

  <div class="mt-6 text-center">
    <router-link class="text-center text-base-medium hover:underline" :to="{ name: 'mail-login' }">
      {{ sent ? __('Back to log in') : __('Remember your password? Log in.') }}
    </router-link>
  </div>
</template>
<script setup lang="ts">
import { Alert, Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { api, useMutation } from '@/api'

const route = useRoute()

const email = ref('')
const sent = ref(false)
// ResetPasswordView sends a used, expired or mistyped link here with this flag.
const linkFailed = computed(() => route.query.expired !== undefined)

const sendResetLink = useMutation(api.mail.public.sendResetLink, { silent: true })
async function send() {
  await sendResetLink.run({ user: email.value })
  sent.value = true
}
</script>
