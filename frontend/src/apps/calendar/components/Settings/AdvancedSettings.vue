<!--
  Calendar > Advanced: the CalDAV details a third-party calendar app needs.
  The group shows this tab only when the server has a CalDAV URL.
-->
<template>
  <SettingsPage
    :title="__('Advanced')"
    :description="__('Connect a calendar app such as Apple Calendar or Thunderbird')"
    :loading="!config"
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
          __('Calendar apps sign in with your mail account password, not with your API key.')
        "
      />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { SettingsRow } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { SettingsCopyField, SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const clientConfig = useQuery(api.mail.calendar.clientConfig)
const config = computed(() => clientConfig.data)
</script>
