<template>
  <!-- Host for an area's route group. Renders the area's nested <router-view>. -->
  <router-view />
</template>

<script setup lang="ts">
import { computed, onScopeDispose } from 'vue'
import { useRoute } from 'vue-router'

import { useSessionStore } from '@/boot/session'
import type { SettingsTabId } from '@/shell/settings/settings'
import { openSettings } from '@/shell/settings/useSettingsDialog'
import { useRootStore } from '@/stores/root'

const route = useRoute()
const session = useSessionStore()
// Calendar and Meet register the Settings command here. Mail and Drive
// register their own.
const showCommonSettings = computed(
  () =>
    session.isLoggedIn &&
    (route.meta.area === 'calendar' ||
      (route.meta.area === 'meet' && route.name !== 'meet-meeting')),
)
// Calendar opens Settings on its own first tab.
const settingsTab = computed<SettingsTabId | undefined>(() =>
  route.meta.area === 'calendar' ? 'calendar.calendars' : undefined,
)

const unregisterPaletteGroups = useRootStore().registerPaletteGroups(
  'common-settings',
  computed(() =>
    showCommonSettings.value
      ? [
          {
            commands: [
              {
                id: `${String(route.meta.area)}-settings`,
                label: 'Settings',
                shortcut: 'Mod+Shift+Comma',
                enterHint: 'open settings',
                icon: 'lucide-settings',
                keywords: ['profile', 'preferences', 'workspace'],
                run: () => openSettings(settingsTab.value),
              },
            ],
          },
        ]
      : [],
  ),
)
onScopeDispose(unregisterPaletteGroups)
</script>
