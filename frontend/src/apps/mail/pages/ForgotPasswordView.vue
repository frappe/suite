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
    <form class="flex flex-col space-y-4" @submit.prevent="sendResetLink.submit({ user: email })">
      <FormControl
        v-model="email"
        :label="__('Email')"
        placeholder="johndoe@example.com"
        autocomplete="email"
        required
      />
      <ErrorMessage :message="sendResetLink.error" />
      <Button variant="solid" :loading="sendResetLink.loading" type="submit">
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
import { Button, createResource, ErrorMessage, FormControl } from 'frappe-ui'
import { ref } from 'vue'

const email = ref('')
const user = ref('')

const sendResetLink = createResource({
  url: 'suite.mail.api.account.send_reset_password_link',
  onSuccess: (data: string) => (user.value = data),
})
</script>
