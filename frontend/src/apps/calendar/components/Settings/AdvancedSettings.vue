<!--
  Calendar > Advanced: the CalDAV details a third-party calendar app needs.
  The group shows this tab only when the server has a CalDAV URL. The
  password row says what Mail > Advanced > Mail clients says: apps sign in
  with the mail password, which Security sets only on a password change.
-->
<template>
  <SettingsPage
    :title="__('Advanced')"
    :description="__('Connect a calendar app such as Apple Calendar or Thunderbird')"
    :loading="!config"
    :reads="[clientConfig]"
  >
    <SettingsSection
      v-if="config"
      :title="__('CalDAV')"
      :description="
        __(
          'Apps that find the server on their own need only the server URL. Others need the calendar URL too.',
        )
      "
    >
      <SettingsCopyField :label="__('Server URL')" :value="config.server_url ?? ''" />
      <SettingsCopyField :label="__('Calendar URL')" :value="config.calendar_url ?? ''" />
      <SettingsCopyField :label="__('Username')" :value="config.username ?? ''" />
      <SettingsRow
        :title="__('Password')"
        :description="
          __(
            'Sign in with your mail password. If you do not know it, change your Suite password in Security. When Suite hosts your mail, that sets your mail password to the same one.',
          )
        "
      >
        <Button :label="__('Open Security')" @click="openSettings('account.security')" />
      </SettingsRow>
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Button, SettingsRow } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { openSettings } from '@/platform/settings'
import { SettingsCopyField, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const clientConfig = useQuery(api.mail.calendar.clientConfig)
const config = computed(() => clientConfig.data)
</script>
