<template>
  <div class="flex h-screen flex-col bg-surface-base">
    <main class="min-h-0 flex-1 overflow-auto">
      <slot />
    </main>
    <SuiteCommandPalette />
    <!-- The suite is one PWA, so the offer to install it is the shell's, not
         an app's; it decides for itself when to show. -->
    <InstallPrompt v-if="isMobile" />
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose } from 'vue'
import { useKeyboardShortcut } from 'frappe-ui'
import SuiteCommandPalette from './SuiteCommandPalette.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import { useTheme } from '@/composables/useTheme'
import InstallPrompt from '@/shell/InstallPrompt.vue'
import { openSettings } from '@/shell/settings/useSettingsDialog'
import { useSessionStore } from '@/boot/session'
import { useRootStore } from '@/stores/root'
import { nextTheme } from '@/utils/themeValues'

const root = useRootStore()
const session = useSessionStore()
const { isMobile } = useScreenSize()
const { cycleTheme, themeMode } = useTheme()
const nextThemeMode = computed(() => nextTheme(themeMode.value))

const unregisterPaletteGroups = root.registerPaletteGroups('suite-layout', computed(() => [
  {
    commands: [
      ...(session.isLoggedIn
        ? [{
            id: 'suite-settings',
            label: 'Settings',
            shortcut: 'Mod+Shift+Comma',
            enterHint: 'open settings',
            icon: 'lucide-settings',
            keywords: ['profile', 'preferences', 'workspace'],
            run: () => openSettings(),
          }]
        : []),
      {
        id: 'suite-cycle-theme',
        label: `Switch to ${nextThemeMode.value} mode`,
        shortcut: 'Mod+Shift+L',
        enterHint: `switch to ${nextThemeMode.value} mode`,
        icon: nextThemeMode.value === 'light'
          ? 'lucide-sun'
          : nextThemeMode.value === 'dark'
            ? 'lucide-moon'
            : 'lucide-monitor',
        keywords: ['appearance', 'color scheme', 'theme'],
        keepOpen: true,
        run: cycleTheme,
      },
    ],
  },
]))

useKeyboardShortcut([
  {
    combo: 'Mod+Shift+Comma',
    description: 'Open Settings',
    group: 'Suite',
    enabled: () => session.isLoggedIn,
    handler: () => openSettings(),
  },
  {
    combo: 'Mod+Shift+L',
    description: 'Cycle Theme',
    group: 'Suite',
    handler: cycleTheme,
  },
])

onScopeDispose(unregisterPaletteGroups)
</script>
