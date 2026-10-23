<template>
  <p v-if="user" class="text-base leading-6">
    {{
      __(
        'We have sent an email to {0}. Please click on the link received to reset your password.',
        [user],
      )
    }}
  </p>

  <template v-else>
    <form class="flex flex-col space-y-4" @submit.prevent="send()">
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
      <router-link
        class="text-center text-base-medium hover:underline"
        :to="{ name: 'mail-login' }"
      >
        {{ __('Remember your password? Log in.') }}
      </router-link>
    </div>
  </template>
</template>
<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { ref } from 'vue'

import { api, useMutation } from '@/api'

const email = ref('')
const user = ref('')

const sendResetLink = useMutation(api.mail.public.sendResetLink, { silent: true })
async function send() {
  user.value = await sendResetLink.run({ user: email.value })
}
</script>
