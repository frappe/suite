<!--
  Drive > External access: WebDAV access to Drive. A Drive admin turns it on
  for the site. Each user then turns it on for their own files and reads the
  connection details. The API key a client can sign in with is made in
  Account > Security, so this tab links there.
-->
<template>
  <SettingsPage
    :description="__('Connect Drive to desktop, mobile, and other file apps')"
    :loading="!webdavAnswer.data"
    :reads="[webdavAnswer]"
  >
    <SettingsSection v-if="answer.is_admin || connection">
      <SettingsRow
        v-if="answer.is_admin"
        :title="__('Enable WebDAV')"
        :description="
          __('Let WebDAV clients, such as Finder, Windows Explorer and rclone, connect to Drive')
        "
      >
        <Switch
          :model-value="siteEnabled"
          :disabled="saveSite.isPending"
          @update:model-value="setSiteEnabled"
        />
      </SettingsRow>
      <SettingsRow
        v-if="connection"
        :title="__('Allow WebDAV access to my files')"
        :description="__('Turn this on before you connect a client')"
      >
        <Switch
          :model-value="userEnabled"
          :disabled="saveUser.isPending"
          @update:model-value="setUserEnabled"
        />
      </SettingsRow>
    </SettingsSection>

    <!-- The DAV mount is the caller's Personal root only (`suite/drive/webdav/pathmap.py`). -->
    <SettingsSection
      v-if="connection"
      :title="__('Client configuration')"
      :description="
        __('Connect a WebDAV client with these details. It shows My files, not {0}.', [
          locationLabel('organization'),
        ])
      "
    >
      <SettingsCopyField :label="__('Server URL')" :value="connection.server_url" />
      <SettingsCopyField :label="__('Username')" :value="connection.username" />
      <SettingsRow :title="__('API key')" :description="signInText">
        <Button :label="__('Open Security')" @click="openSettings('account.security')" />
      </SettingsRow>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Button, SettingsRow, Switch } from 'frappe-ui'
import { computed } from 'vue'

import { api, useMutation, useQuery } from '@/api'
import type { WebdavGetOutput } from '@/apps/drive/client/generated'
import { openSettings } from '@/platform/settings'
import { SettingsCopyField, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

import { locationLabel } from '../../internal/locations'

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

// The owner policy updates these reads immediately and rolls back refused writes.
const siteEnabled = computed(() => answer.value.globally_enabled === true)
const userEnabled = computed(() => answer.value.enabled_for_user === true)

async function setSiteEnabled(value: boolean) {
  await saveSite.run({ webdav_enabled: value })
}

async function setUserEnabled(value: boolean) {
  await saveUser.run({ webdav_enabled: value })
}

// With two-factor sign-in a client cannot send a password and a code, so the key is the only way in.
const signInText = computed(() =>
  connection.value?.two_factor_blocked
    ? __(
        'Your account uses two-factor authentication, so WebDAV clients sign in with your API key and secret. Make them in Account > Security.',
      )
    : __(
        'WebDAV clients sign in with your password, or with your API key and secret. Make the key in Account > Security.',
      ),
)
</script>
