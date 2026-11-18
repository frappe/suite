<!--
  Mail > Advanced > Mail clients: the read-only server details for connecting an app such as
  Thunderbird or Apple Mail over IMAP and SMTP. The section shows only when the site has the
  details: an administrator turns them on in Mail Settings, and enters them or lets Suite Cloud
  read them from DNS (`get_mail_client_config`).

  Clients sign in with the mail account's own password. Provisioning sets it to a random token
  (`account_lifecycle.provision`); Suite Cloud sets it to the Suite password only when the user
  changes that (`complete_password_change`). So the copy never says the two are the same, and links
  to Security. Calendar > Advanced says the same for CalDAV. The app password under Connection is a
  different secret, used only by Suite.
-->
<template>
  <SettingsSection
    v-if="clientConfig.data?.length"
    :title="__('Mail clients')"
    :description="
      __('To use another mail app, such as Thunderbird or Apple Mail, enter these details in it.')
    "
  >
    <SettingsCopyField :label="__('Username')" :value="user.data?.email ?? ''" />
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
  </SettingsSection>
</template>

<script setup lang="ts">
import { Badge, Button, SettingsRow } from 'frappe-ui'

import { api, useQuery } from '@/api'
import { userStore } from '@/apps/mail/stores/user'
import { openSettings } from '@/platform/settings'
import { SettingsCopyField, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

const user = userStore().userResource
const clientConfig = useQuery(api.mail.settings.clientConfig, () => ({}))
</script>
