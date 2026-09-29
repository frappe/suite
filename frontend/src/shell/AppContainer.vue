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
import { computed, onScopeDispose } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/boot/session'
import SuiteSettingsDialog from '@/shell/settings/SuiteSettingsDialog.vue'
import {
  openSettings,
  settingsTab,
  showSettings,
} from '@/shell/settings/useSettingsDialog'
import { useRootStore } from '@/stores/root'

const route = useRoute()
const session = useSessionStore()
const appsUsingCommonSettings = ['slides', 'sheets', 'writer']
const showCommonSettings = computed(
  () =>
    session.isLoggedIn &&
    (appsUsingCommonSettings.includes(String(route.meta.appId || '')) ||
      (route.meta.appId === 'meet' && route.name !== 'meet-meeting')),
)

const unregisterPaletteGroups = useRootStore().registerPaletteGroups(
  'common-settings',
  computed(() =>
    showCommonSettings.value
      ? [
          {
            commands: [
              {
                id: `${String(route.meta.appId)}-settings`,
                label: 'Settings',
                shortcut: 'Mod+Shift+Comma',
                enterHint: 'open settings',
                icon: 'lucide-settings',
                keywords: ['profile', 'preferences', 'workspace'],
                run: () => openSettings(),
              },
            ],
          },
        ]
      : [],
  ),
)
onScopeDispose(unregisterPaletteGroups)
</script>
