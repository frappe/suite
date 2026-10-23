<template>
  <SettingList>
    <SettingRow
      title="Desktop notifications"
      description="Send a system notification when new mail arrives."
    >
      <Switch v-model="desktopNotifications" />
    </SettingRow>
    <SettingRow
      title="Notification sound"
      description="Play a subtle sound when new mail arrives."
    >
      <Switch v-model="notificationSound" />
    </SettingRow>
  </SettingList>
</template>

<script setup lang="ts">
import { Switch } from 'frappe-ui'

import { desktopNotifications, notificationSound } from '../../mailSettings'
import SettingList from './SettingList.vue'
import SettingRow from './SettingRow.vue'
</script>
