<!--
  WebDAV access to Drive. A Drive admin turns it on for the site. Each user
  then turns it on for their own files and reads the connection details.
-->
<template>
  <SettingsPage
    :title="__('External access')"
    :description="__('Open your Drive files in Finder, Windows Explorer and other file apps.')"
  >
    <div class="flex flex-col gap-10">
      <div v-if="connection">
        <!-- The DAV mount is the caller's Personal root only (`suite/drive/webdav/pathmap.py`) -->
        <SettingsRow
          :title="__('Connect file apps')"
          :description="
            __('Uses WebDAV. Shows My files, not {0}.', [locationLabel('organization')])
          "
        >
          <Switch
            :model-value="userEnabled"
            :disabled="saveUser.isPending"
            :aria-label="__('Connect file apps')"
            @update:model-value="setUserEnabled"
          />
        </SettingsRow>
        <!-- No use until the switch is on, so they stay back until then. The row's own space
             below is all that parts them from it -->
        <div v-if="userEnabled" class="flex flex-col gap-4">
          <CopyField :label="__('Server URL')" :value="connection.server_url" />
          <CopyField :label="__('Username')" :value="connection.username" />
          <CopyField v-if="connection.api_key" :label="__('API key')" :value="connection.api_key" />
          <div class="flex flex-col gap-1.5">
            <span class="text-sm text-ink-gray-6">{{ __('Password') }}</span>
            <div class="flex items-center justify-between gap-3">
              <p class="text-base text-ink-gray-8">{{ passwordHint }}</p>
              <Button
                class="shrink-0"
                :label="generateLabel"
                :loading="generate.isPending"
                @click="generateKeys"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Below a user's own switch: it is set once for the site, and only an admin sees it -->
      <SettingsSection v-if="answer.is_admin" :title="__('Workspace')">
        <SettingsRow
          :title="__('Let everyone connect file apps')"
          :description="__('Each person then turns it on for their own files.')"
        >
          <Switch
            :model-value="siteEnabled"
            :disabled="saveSite.isPending"
            :aria-label="__('Let everyone connect file apps')"
            @update:model-value="setSiteEnabled"
          />
        </SettingsRow>
      </SettingsSection>
    </div>

    <AdaptiveDialog v-model:open="showSecret" :title="__('API access')">
      <div class="flex flex-col gap-4">
        <p class="text-base text-ink-gray-7">
          {{ __('Copy the API secret now. You cannot see it again.') }}
        </p>
        <CopyField v-if="keys" :label="__('API key')" :value="keys.api_key" />
        <CopyField v-if="keys" :label="__('API secret')" :value="keys.api_secret" />
      </div>
    </AdaptiveDialog>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Button, SettingsRow, Switch } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import type { WebdavGetOutput } from '@/apps/drive/client/generated'
import AdaptiveDialog from '@/platform/feedback/AdaptiveDialog.vue'
import SettingsPage from '@/platform/settings/SettingsPage.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

import { locationLabel } from '../../internal/locations'
import CopyField from './CopyField.vue'

type Connection = Extract<WebdavGetOutput, { server_url: string }>

const webdavAnswer = useQuery(api.drive.webdav.get, {})
const answer = computed<Partial<Connection>>(() => webdavAnswer.data ?? {})
const connection = computed(() => {
  const data = webdavAnswer.data
  return data && isConnection(data) ? data : null
})

function isConnection(answer: WebdavGetOutput): answer is Connection {
  return 'server_url' in answer
}

// A failed write reports itself through the platform error toast.
const saveSite = useMutation(api.drive.siteSettings.update)
const saveUser = useMutation(api.drive.settings.update)
const generate = useMutation(api.suite.account.generateKeys)

// The owner policy updates these reads immediately and rolls back refused writes.
const siteEnabled = computed(() => answer.value.globally_enabled === true)
const userEnabled = computed(() => answer.value.enabled_for_user === true)

async function setSiteEnabled(value: boolean) {
  await saveSite.run({ webdav_enabled: value })
}

async function setUserEnabled(value: boolean) {
  await saveUser.run({ webdav_enabled: value })
}

// With two-factor on, a WebDAV client can't sign in with the password
const passwordHint = computed(() => {
  const hasKey = !!connection.value?.api_key

  if (connection.value?.two_factor_blocked) {
    if (hasKey) {
      return __('Use the API key and its secret. Two-factor blocks your password here.')
    }

    return __('Use an API key. Two-factor blocks your password here.')
  }

  if (hasKey) {
    return __('Your Suite password, or the API key and its secret.')
  }

  return __('Your Suite password, or an API key.')
})
const generateLabel = computed(() => {
  if (connection.value?.api_key) {
    return __('Regenerate secret')
  }

  return __('Generate API key')
})

const keys = ref<{ api_key: string; api_secret: string } | null>(null)
const showSecret = ref(false)

async function generateKeys() {
  if (!connection.value) return
  const result = await generate.run({ user: connection.value.username })

  keys.value = result
  showSecret.value = true
}

// The secret shows once. Drop it when the dialog closes.
watch(showSecret, (open) => {
  if (!open) keys.value = null
})
</script>
