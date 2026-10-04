<template>
  <AppSettingsHeader :title="__('Credentials')">
    <template v-if="userSettings.doc" #actions>
      <Button
        :label="__('Save')"
        variant="solid"
        :loading="saveSettings.loading"
        :disabled="isNotDirty"
        @click="() => saveSettings.submit()"
      />
    </template>
  </AppSettingsHeader>
  <AppSettingsBody>
    <template v-if="userSettings.doc">
      <div class="flex flex-col gap-5">
        <h2 class="text-base-semibold text-ink-gray-8">{{ __('Connection') }}</h2>
        <FormControl
          :model-value="userSettings.doc.server_url"
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

        <ErrorMessage :message="saveSettings.error as Error | undefined" />
      </div>
    </template>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import {
  Button,
  createDocumentResource,
  createResource,
  ErrorMessage,
  FormControl,
} from 'frappe-ui'
import { computed, inject, ref, watch } from 'vue'

import type { UserResource } from '@/apps/mail/types'
import { raiseToast } from '@/apps/mail/utils'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

const user = inject('$user') as UserResource

// get_user_info always ensures a User Settings doc exists and returns its name, so this is set.
const userSettingsName = user.data.user_settings as string

const userSettings = createDocumentResource({
  doctype: 'User Settings',
  name: userSettingsName,
})

const username = ref('')
// Password fields come back masked from the API, so we never prefill this. It stays blank and is
// only sent on save when the user actually types a new value (see makeParams below).
const appPassword = ref('')
const backupEmail = ref('')
const hasPassword = ref(false)

// Sync the local inputs from the doc once it loads (and after a reload).
watch(
  () => userSettings.doc,
  (doc) => {
    if (!doc) return
    username.value = doc.username ?? ''
    backupEmail.value = doc.backup_email ?? ''
    hasPassword.value = !!doc.app_password
    appPassword.value = ''
  },
  { immediate: true },
)

const isNotDirty = computed(
  () =>
    username.value === (userSettings.doc?.username ?? '') &&
    backupEmail.value === (userSettings.doc?.backup_email ?? '') &&
    appPassword.value === '',
)

const saveSettings = createResource({
  url: 'frappe.client.set_value',
  makeParams: () => {
    const fieldname: Record<string, string | null> = {
      username: username.value || null,
      backup_email: backupEmail.value || null,
    }
    // Only overwrite the stored password when the user entered a new one.
    if (appPassword.value) fieldname.app_password = appPassword.value

    return {
      doctype: 'User Settings',
      name: userSettingsName,
      fieldname,
    }
  },
  onSuccess: () => {
    raiseToast(__('Credentials updated.'))
    appPassword.value = ''
    userSettings.reload()
    // Refresh shared user data so is_jmap_configured / username reflect the change app-wide.
    user.reload()
  },
  onError: () => raiseToast(__('Unable to save credentials.'), 'error'),
})
</script>
