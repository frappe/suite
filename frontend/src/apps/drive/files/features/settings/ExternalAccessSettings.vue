<!--
  WebDAV access to Drive. A Drive admin turns it on for the site. Each user
  then turns it on for their own files and reads the connection details.
-->
<template>
  <SettingsPage
    :title="__('External access')"
    :description="__('Connect Drive to desktop, mobile, and other file apps')"
  >
    <div class="flex flex-col gap-6">
      <SettingsRow
        v-if="answer.is_admin"
        :title="__('Enable WebDAV')"
        :description="__('Let WebDAV clients, such as Finder, Windows Explorer and rclone, connect to Drive')"
      >
        <Switch
          :model-value="siteEnabled"
          :disabled="saveSite.isPending"
          :aria-label="__('Enable WebDAV')"
          @update:model-value="setSiteEnabled"
        />
      </SettingsRow>

      <template v-if="connection">
        <SettingsRow
          :title="__('Allow WebDAV access to my files')"
          :description="__('Turn this on before you connect a client')"
        >
          <Switch
            :model-value="userEnabled"
            :disabled="saveUser.isPending"
            :aria-label="__('Allow WebDAV access to my files')"
            @update:model-value="setUserEnabled"
          />
        </SettingsRow>

        <section class="flex flex-col gap-4">
          <div class="space-y-1">
            <h3 class="text-base font-semibold text-ink-gray-8">{{ __('Client configuration') }}</h3>
            <p class="text-base text-ink-gray-6">
              {{ __('Connect a WebDAV client with these details. It shows your Home folder and the shared Everyone folder.') }}
            </p>
          </div>
          <CopyField :label="__('Server URL')" :value="connection.server_url" />
          <CopyField :label="__('Username')" :value="connection.username" />
          <p class="text-sm text-ink-gray-5">
            {{ __('Sign in with your password, or use the API key and secret in place of the username and password.') }}
          </p>
          <p v-if="connection.two_factor_blocked" class="text-sm text-ink-amber-3">
            {{ __('Your account uses two-factor authentication. A WebDAV client cannot sign in with your password, so use an API key and secret.') }}
          </p>
        </section>

        <section class="flex flex-col gap-4 border-t pt-6">
          <h3 class="text-base font-semibold text-ink-gray-8">{{ __('API access') }}</h3>
          <CopyField v-if="connection.api_key" :label="__('API key')" :value="connection.api_key" />
          <p v-else class="text-base text-ink-gray-6">
            {{ __('You do not have an API key yet. Generate one to sign in without your password.') }}
          </p>
          <Button
            class="self-start"
            :label="connection.api_key ? __('Regenerate secret') : __('Generate keys')"
            :loading="generate.isPending"
            @click="generateKeys"
          />
        </section>
      </template>
    </div>

    <Dialog v-model:open="showSecret" :title="__('API access')">
      <div class="flex flex-col gap-4">
        <p class="text-base text-ink-gray-7">
          {{ __('Copy the API secret now. You cannot see it again.') }}
        </p>
        <CopyField v-if="keys" :label="__('API key')" :value="keys.api_key" />
        <CopyField v-if="keys" :label="__('API secret')" :value="keys.api_secret" />
      </div>
    </Dialog>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Dialog, SettingsRow, Switch } from 'frappe-ui'

import type { WebdavGetOutput } from '@/apps/drive/client/generated'
import { generateUserKeys, saveSiteSettings, saveUserSettings, webdav } from '@/apps/drive/client/settings'
import { useMutation, useQuery } from '@/platform/server-state'
import { translate as __ } from '@/platform/translation'
import CopyField from './CopyField.vue'
import SettingsPage from './SettingsPage.vue'

type Connection = Extract<WebdavGetOutput, { server_url: string }>

const webdavAnswer = useQuery(webdav())
const answer = computed<Partial<Connection>>(() => webdavAnswer.data ?? {})
const connection = computed(() => {
  const data = webdavAnswer.data
  return data && isConnection(data) ? data : null
})

function isConnection(answer: WebdavGetOutput): answer is Connection {
  return 'server_url' in answer
}

// A failed write reports itself through the platform error toast.
const saveSite = useMutation(saveSiteSettings)
const saveUser = useMutation(saveUserSettings)
const generate = useMutation(generateUserKeys)

// The switches show the new value at once; the answer refetch confirms it.
const siteEnabled = ref(false)
const userEnabled = ref(false)
watch(
  answer,
  (value) => {
    siteEnabled.value = value.globally_enabled === true
    userEnabled.value = value.enabled_for_user === true
  },
  { immediate: true },
)

async function setSiteEnabled(value: boolean) {
  siteEnabled.value = value
  await saveSite.run({ webdav_enabled: value })
  if (saveSite.error) siteEnabled.value = !value
}

async function setUserEnabled(value: boolean) {
  userEnabled.value = value
  await saveUser.run({ webdav_enabled: value })
  if (saveUser.error) userEnabled.value = !value
}

const keys = ref<{ api_key: string; api_secret: string } | null>(null)
const showSecret = ref(false)

async function generateKeys() {
  if (!connection.value) return
  const result = await generate.run({ user: connection.value.username })
  if (!result) return
  keys.value = result
  showSecret.value = true
}

// The secret shows once. Drop it when the dialog closes.
watch(showSecret, (open) => {
  if (!open) keys.value = null
})
</script>
