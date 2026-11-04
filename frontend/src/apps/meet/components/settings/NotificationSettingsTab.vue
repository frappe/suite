<template>
  <AppSettingsHeader
    title="Notifications"
    description="Customize notification sounds for meeting events"
  />
  <AppSettingsBody>
    <div class="space-y-6">
      <SettingsRow
        title="Enable notification sounds"
        description="Play sounds for all meeting events"
      >
        <Switch v-model="notificationChimesEnabledLocal" />
      </SettingsRow>
    </div>
  </AppSettingsBody>
</template>

<script setup lang="ts">
import { SettingsRow, Switch } from 'frappe-ui'
import { ref, watch, type Ref } from 'vue'

import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'

import {
  notificationChimesEnabled,
  setNotificationChimesEnabled,
} from '../../data/notificationPreferences'

const notificationChimesEnabledLocal: Ref<boolean> = ref(notificationChimesEnabled.value)

watch(notificationChimesEnabledLocal, (newValue) => {
  setNotificationChimesEnabled(newValue)
})
</script>
