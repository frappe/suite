<template>
  <AppSettingsHeader :title="__('Incoming')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <InboxCategorySettings />
      <!-- Who may reach the Inbox and what they may load as you read: the Screener's senders, and
           remote images, which trusted senders' mail shows. -->
      <SettingsSection :title="__('Senders')">
        <div class="divide-y divide-outline-gray-1">
          <ScreenedEmailAddressSettings />
          <SettingsRow
            v-if="preferences"
            :title="__('Block remote images')"
            :description="__(`Don’t load remote images from untrusted sources by default.`)"
          >
            <Switch v-model="blockRemoteImages" />
          </SettingsRow>
        </div>
      </SettingsSection>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'

import InboxCategorySettings from '@/apps/mail/components/Settings/InboxCategorySettings.vue'
import ScreenedEmailAddressSettings from '@/apps/mail/components/Settings/ScreenedEmailAddressSettings.vue'
import { useAccountPreferences } from '@/apps/mail/composables/useAccountPreferences'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsSection from '@/platform/settings/SettingsSection.vue'
import { translate as __ } from '@/platform/translation'

const { preferences, flag } = useAccountPreferences()
const blockRemoteImages = flag('block_remote_images')
</script>
