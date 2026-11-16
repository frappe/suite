<!--
  Mail > Advanced > Connection: how Suite signs in to this person's mailbox on the mail server, and
  the backup address for account problems. The fields save together.
-->
<template>
  <SettingsSection
    :title="__('Connection')"
    :description="
      __('How Suite signs in to your mailbox. Change it only if your administrator asks.')
    "
  >
    <SettingsLoading v-if="!credentials.data" />
    <SettingsForm v-else :dirty="dirty" :save="save">
      <FormControl
        :model-value="credentials.data.server_url ?? ''"
        :label="__('Server URL')"
        disabled
        :placeholder="__('Not set up')"
        :description="__('Set by your administrator')"
      />
      <div class="grid gap-4 sm:grid-cols-2">
        <FormControl
          v-model="username"
          :label="__('Username')"
          autocomplete="off"
          :placeholder="__('user@example.com')"
        />
        <FormControl
          v-model="appPassword"
          type="password"
          autocomplete="new-password"
          :label="__('App password')"
          :placeholder="credentials.data.has_password ? __('Unchanged') : ''"
        />
      </div>
      <FormControl
        v-model="backupEmail"
        type="email"
        :label="__('Backup email')"
        :description="__('Where we write to you if there is a problem with this account')"
      />
    </SettingsForm>
  </SettingsSection>
</template>

<script setup lang="ts">
import { FormControl } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery, type InputOf } from '@/api'
import { toast } from '@/platform/feedback'
import { SettingsForm, SettingsLoading, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const credentials = useQuery(api.mail.settings.credentials)

const username = ref('')
// The password comes back masked, so the field starts blank and is sent only when typed in.
const appPassword = ref('')
const backupEmail = ref('')
watch(
  () => credentials.data,
  (data) => {
    if (!data) return
    username.value = data.username ?? ''
    backupEmail.value = data.backup_email ?? ''
    appPassword.value = ''
  },
  { immediate: true },
)

const dirty = computed(
  () =>
    username.value !== (credentials.data?.username ?? '') ||
    backupEmail.value !== (credentials.data?.backup_email ?? '') ||
    appPassword.value !== '',
)

const update = useMutation(api.mail.settings.updateCredentials)
async function save() {
  const input: InputOf<typeof api.mail.settings.updateCredentials> = {
    username: username.value || null,
    backup_email: backupEmail.value || null,
  }
  if (appPassword.value) input.app_password = appPassword.value
  await update.run(input)
  appPassword.value = ''
  toast.success(__('Connection saved'))
}
</script>
