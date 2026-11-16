<!--
  Account > Security: the password and the API key. The key is the Frappe
  user's API key and secret: WebDAV clients for Drive and scripts that call
  the Suite API sign in with it. Mail (IMAP, SMTP) and CalDAV clients sign in
  with the mail account password instead. It is made here once; the app tabs
  that need it link to this tab.
-->
<template>
  <SettingsPage
    :title="__('Security')"
    :description="__('Your password, and the key apps use to sign in for you')"
    :loading="!user.data"
  >
    <SettingsSection v-if="user.data">
      <SettingsRow
        :title="__('Password')"
        :description="__('Change the password you sign in with')"
      >
        <Button :label="__('Change password')" @click="showPasswordDialog = true" />
      </SettingsRow>
      <!-- A SettingsRow, with the key under the description: the left side
           of frappe-ui's row takes no slot. -->
      <div class="flex items-center gap-8 py-3.5">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-base-medium leading-tighter text-ink-gray-8">{{ __('API key') }}</span>
          <p class="text-base leading-5 text-ink-gray-6">
            {{
              __(
                'WebDAV clients for Drive, and scripts that use the API, sign in with a key and secret in place of your password',
              )
            }}
          </p>
          <div v-if="user.data.api_key" class="mt-1 flex min-w-0 items-center gap-1">
            <code class="truncate font-mono text-sm text-ink-gray-8">{{ user.data.api_key }}</code>
            <Button
              variant="ghost"
              size="sm"
              icon="lucide-copy"
              :aria-label="__('Copy {0}', [__('API key')])"
              @click="copyKey(user.data.api_key)"
            />
          </div>
        </div>
        <Button
          v-if="user.data.api_key"
          class="shrink-0"
          :label="__('Regenerate')"
          :loading="generate.isPending"
          @click="regenerateKeys"
        />
        <Button
          v-else
          class="shrink-0"
          :label="__('Generate key')"
          :loading="generate.isPending"
          @click="generateKeys"
        />
      </div>
    </SettingsSection>
  </SettingsPage>

  <Dialog v-model:open="showPasswordDialog" v-bind="passwordDialogOptions">
    <template #default>
      <form class="space-y-4" @submit.prevent>
        <!-- Capture username here so Chrome doesn't fill profile last name -->
        <input
          type="text"
          name="username"
          autocomplete="username"
          tabindex="-1"
          aria-hidden="true"
          :value="userId"
          readonly
          class="pointer-events-none absolute h-0 w-0 opacity-0"
        />
        <FormControl
          v-model="currentPassword"
          type="password"
          name="current-password"
          autocomplete="current-password"
          :label="__('Current password')"
          placeholder="••••••••"
        />
        <FormControl
          v-model="newPassword"
          type="password"
          name="new-password"
          autocomplete="new-password"
          :label="__('New password')"
          placeholder="••••••••"
        />
        <FormControl
          v-model="confirmPassword"
          type="password"
          name="confirm-password"
          autocomplete="new-password"
          :label="__('Confirm new password')"
          placeholder="••••••••"
        />
        <ErrorMessage :message="passwordError" />
      </form>
    </template>
  </Dialog>

  <Dialog v-model:open="showSecret" :title="__('API key and secret')">
    <div class="flex flex-col gap-2">
      <p class="text-p-base text-ink-gray-7">
        {{ __('Copy the secret now. You cannot see it again.') }}
      </p>
      <template v-if="keys">
        <SettingsCopyField :label="__('API key')" :value="keys.api_key" />
        <SettingsCopyField :label="__('API secret')" :value="keys.api_secret" />
      </template>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog, ErrorMessage, FormControl, SettingsRow } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import { confirm, toast } from '@/platform/feedback'
import { useSession } from '@/platform/session'
import { SettingsCopyField, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const session = useSession()
const userId = session.user.value?.id ?? ''

const user = useQuery(api.suite.preferences.get)

// Password

const showPasswordDialog = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const updatePassword = useMutation(api.suite.account.changePassword)

const passwordError = computed(() => {
  if (confirmPassword.value && confirmPassword.value !== newPassword.value)
    return __('Passwords do not match')
  const error: unknown = updatePassword.error
  return error instanceof Error ? error : undefined
})

const passwordDialogOptions = computed(() => ({
  title: __('Change password'),
  actions: [
    {
      label: __('Confirm'),
      variant: 'solid' as const,
      onClick: () => changePassword(),
      disabled:
        !(currentPassword.value.length && newPassword.value.length) ||
        confirmPassword.value !== newPassword.value,
      loading: updatePassword.isPending,
    },
  ],
}))

async function changePassword() {
  await updatePassword.run({
    old_password: currentPassword.value,
    new_password: newPassword.value,
  })
  showPasswordDialog.value = false
  toast.success(__('Password updated'))
}

watch(showPasswordDialog, (open) => {
  if (!open) {
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    updatePassword.reset()
  }
})

// API key

const generate = useMutation(api.suite.account.generateKeys)
const keys = ref<{ api_key: string; api_secret: string } | null>(null)
const showSecret = ref(false)

async function generateKeys() {
  keys.value = await generate.run({ user: userId })
  showSecret.value = true
}

async function copyKey(key: string) {
  try {
    await navigator.clipboard.writeText(key)
    toast.success(__('Copied'))
  } catch {
    toast.error(__('Could not copy. Select the text and copy it.'))
  }
}

async function regenerateKeys() {
  const confirmed = await confirm({
    title: __('Regenerate the API secret?'),
    message: __(
      'Apps and scripts that sign in with the current secret stop working until you give them the new one.',
    ),
    confirmLabel: __('Regenerate'),
    destructive: true,
  })
  if (confirmed) await generateKeys()
}

// The secret shows once. Drop it when the dialog closes.
watch(showSecret, (open) => {
  if (!open) keys.value = null
})
</script>
