<template>
  <AppSettingsHeader :title="__('Sending')" />
  <AppSettingsBody>
    <div class="flex flex-col gap-10">
      <ComposeSettings />
      <div class="divide-y divide-outline-gray-1">
        <SettingsDialogRow
          :title="__('Send-as addresses')"
          :description="__('The addresses you send mail as, each with its own name and signature.')"
          :action="__('Manage')"
          size="2xl"
        >
          <template #default="{ close }">
            <IdentitySettings @saved="close" />
          </template>
        </SettingsDialogRow>
        <SettingsDialogRow
          :title="__('Signatures')"
          :description="__('Saved signatures you can add to a message.')"
          :action="__('Manage')"
        >
          <SignatureSettings />
        </SettingsDialogRow>
        <SettingsDialogRow
          :title="__('Auto-reply')"
          :description="__('A reply sent for you while you’re away.')"
          :action="__('Edit')"
          size="2xl"
        >
          <template #default="{ close }">
            <VacationResponseSettings @saved="close" />
          </template>
        </SettingsDialogRow>
      </div>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import ComposeSettings from '@/apps/mail/components/Settings/ComposeSettings.vue'
import IdentitySettings from '@/apps/mail/components/Settings/IdentitySettings.vue'
import SignatureSettings from '@/apps/mail/components/Settings/SignatureSettings.vue'
import VacationResponseSettings from '@/apps/mail/components/Settings/VacationResponseSettings.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import SettingsDialogRow from '@/platform/settings/SettingsDialogRow.vue'
import { translate as __ } from '@/platform/translation'
</script>
