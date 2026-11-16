<!--
  Mail > Advanced > Mail clients: the read-only server details for connecting an app such as
  Thunderbird or Apple Mail over IMAP and SMTP.
-->
<template>
  <SettingsSection
    :title="__('Mail clients')"
    :description="
      __(
        'To use another mail app, such as Thunderbird or Apple Mail, enter these details in it. Sign in with this username and the password you sign in to Suite with.',
      )
    "
  >
    <SettingsLoading v-if="!clientConfig.data" />
    <template v-else>
      <SettingsCopyField :label="__('Username')" :value="user.data?.email ?? ''" />
      <div
        v-for="server in clientConfig.data"
        :key="`${server.protocol}-${server.port}`"
        class="py-2"
      >
        <div class="mb-1.5 flex items-center gap-2">
          <span class="text-base-medium text-ink-gray-8">{{ server.protocol }}</span>
          <Badge :label="server.connection_security" theme="gray" variant="subtle" />
        </div>
        <div class="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <SettingsCopyField :label="__('Server')" :value="server.hostname" />
          <SettingsCopyField :label="__('Port')" :value="String(server.port)" />
        </div>
      </div>
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
import { Badge } from 'frappe-ui'

import { api, useQuery } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { SettingsCopyField, SettingsLoading, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const user = userStore().userResource
const clientConfig = useQuery(api.mail.settings.clientConfig, () => ({}))
</script>
