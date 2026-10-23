<template>
  <div class="flex h-full items-center justify-center bg-surface-base p-6">
    <div class="w-full max-w-sm space-y-5">
      <h1 class="text-2xl font-semibold text-ink-gray-9">
        {{ changing ? __('Change your temporary password') : __('Account setup required') }}
      </h1>
      <template v-if="changing">
        <p class="text-base text-ink-gray-6">
          {{
            __(
              'Choose a permanent password to enable Suite and Mail clients. Temporary passwords expire after seven days.',
            )
          }}
        </p>
        <FormControl
          v-model="oldPassword"
          type="password"
          autocomplete="current-password"
          :label="__('Temporary password')"
        />
        <FormControl
          v-model="newPassword"
          type="password"
          autocomplete="new-password"
          :label="__('New password')"
        />
        <FormControl
          v-model="confirmation"
          type="password"
          autocomplete="new-password"
          :label="__('Confirm new password')"
        />
        <ErrorMessage :message="change.error?.message" />
        <Button
          variant="solid"
          :label="__('Change password')"
          :loading="change.isPending"
          :disabled="
            !oldPassword ||
            !newPassword ||
            confirmation !== newPassword ||
            newPassword === oldPassword
          "
          @click="submit"
        />
      </template>
      <p v-else class="text-base text-ink-gray-6">
        {{
          __(
            'Your business Mail account is not ready. Ask an Admin to complete or retry account setup. Your retained data is safe.',
          )
        }}
      </p>
      <Button
        :label="__('Log out')"
        @click="
          session.logout().then(() => {
            location.href = '/login'
          })
        "
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref } from 'vue'

import { api, useMutation } from '@/api'
import { useSession } from '@/platform/session'

const session = useSession()
const changing = computed(() => session.user.value?.must_change_password === true)
const oldPassword = ref('')
const newPassword = ref('')
const confirmation = ref('')
const change = useMutation(api.suite.account.changePassword)
const location = window.location
async function submit() {
  await change.run({ old_password: oldPassword.value, new_password: newPassword.value })
  oldPassword.value = newPassword.value = confirmation.value = ''
  await session.refresh()
  window.location.href = '/home'
}
</script>
