<template>
  <!-- Host for a per-app route group. Renders the app's nested <router-view>.
       A per-app port may replace this
       container with its own app-level layout (sidebar/toolbar) by pointing the
       group's component at its own shell in src/apps/<id>/routes.ts. -->
  <router-view />
  <SuiteSettingsDialog
    v-if="showCommonSettings"
    v-model:open="showSettings"
    v-model:tab="settingsTab"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/boot/session'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'
import { settingsTab, showSettings } from '@/shell/settings/useSettingsDialog'

const route = useRoute()
const session = useSessionStore()

const appsUsingCommonSettings = ['slides', 'sheets', 'writer']
const showCommonSettings = computed(() => {
  if (!session.isLoggedIn) return false
  const appId = route.meta.appId as string | undefined
  return appsUsingCommonSettings.includes(appId || '') || (appId === 'meet' && route.name !== 'meet-meeting')
})
</script>
