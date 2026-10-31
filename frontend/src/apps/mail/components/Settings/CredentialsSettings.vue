<template>
  <AppSettingsHeader :title="__('Credentials')">
    <template v-if="userSettings.data" #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :loading="saveSettings.isPending"
        :disabled="isNotDirty"
        @click="() => save()"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <template v-if="userSettings.data">
      <div class="flex flex-col gap-5">
        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Connection') }}</h2>
        <FormControl
          :model-value="userSettings.data.server_url"
          :label="__('Server URL')"
          variant="outline"
          disabled
          :placeholder="__('Not configured')"
          :description="__('The mail server this account connects to. Set by your administrator.')"
        />
        <FormControl
          v-model="username"
          :label="__('Username')"
          variant="outline"
          :placeholder="__('user@example.com')"
        />
        <FormControl
          v-model="appPassword"
          type="password"
          :label="__('App Password')"
          variant="outline"
          :placeholder="hasPassword ? __('Leave blank to keep unchanged') : ''"
          :description="__('Used to connect to your mailbox.')"
        />

        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Recovery') }}</h2>
        <FormControl
          v-model="backupEmail"
          :label="__('Backup Email')"
          variant="outline"
          :description="__(`We'll contact you here if there's an issue with your main account.`)"
        />

        <ErrorMessage :message="saveSettings.error?.message" />
      </div>
    </template>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { Button, ErrorMessage, FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { raiseToast } from '@/apps/mail/utils'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const userSettings = useQuery(api.mail.settings.credentials)

const username = ref('')
// Password fields come back masked from the API, so we never prefill this. It stays blank and is
// only sent on save when the user actually types a new value (see makeParams below).
const appPassword = ref('')
const backupEmail = ref('')
const hasPassword = ref(false)

// Sync the local inputs from the doc once it loads (and after a reload).
watch(
  () => userSettings.data,
  (doc) => {
    if (!doc) return
    username.value = doc.username ?? ''
    backupEmail.value = doc.backup_email ?? ''
    hasPassword.value = doc.has_password
    appPassword.value = ''
  },
  { immediate: true },
)

const isNotDirty = computed(
  () =>
    username.value === (userSettings.data?.username ?? '') &&
    backupEmail.value === (userSettings.data?.backup_email ?? '') &&
    appPassword.value === '',
)

const saveSettings = useMutation(api.mail.settings.updateCredentials, { silent: true })
async function save() {
  await saveSettings.run({
    username: username.value || null,
    backup_email: backupEmail.value || null,
    ...(appPassword.value ? { app_password: appPassword.value } : {}),
  })
  appPassword.value = ''
  raiseToast(__('Credentials updated.'))
  await userSettings.refetch()
}
</script>
