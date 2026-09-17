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
import { useRoute } from 'vue-router'
import SuiteCommandPalette from './SuiteCommandPalette.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import { useTheme } from '@/composables/useTheme'
import InstallPrompt from '@/shell/InstallPrompt.vue'
import { useRootStore } from '@/stores/root'
import { nextTheme, themeActionLabel } from '@/utils/themeValues'

const root = useRootStore()
const route = useRoute()
const { isMobile } = useScreenSize()
const { cycleTheme, themeMode } = useTheme()
const nextThemeMode = computed(() => nextTheme(themeMode.value))
const nextThemeAction = computed(() => themeActionLabel(nextThemeMode.value))
const canChangeTheme = computed(() => route.name !== 'meet-meeting')
const settingsCommand = computed(() =>
  root.paletteGroups
    .flatMap((group) => group.commands)
    .find((command) => command.shortcut === 'Mod+Shift+Comma'),
)

const unregisterPaletteGroups = root.registerPaletteGroups('suite-layout', computed(() => [
  {
    commands: canChangeTheme.value ? [
      {
        id: 'suite-cycle-theme',
        label: nextThemeAction.value,
        shortcut: 'Mod+Shift+K',
        enterHint: nextThemeAction.value.toLowerCase(),
        icon: nextThemeMode.value === 'light'
          ? 'lucide-sun'
          : nextThemeMode.value === 'dark'
            ? 'lucide-moon'
            : 'lucide-monitor',
        keywords: ['appearance', 'color scheme', 'theme'],
        keepOpen: true,
        run: cycleTheme,
      },
    ] : [],
  },
]))

useKeyboardShortcut([
  {
    combo: 'Mod+Shift+Comma',
    description: 'Open Settings',
    group: 'Suite',
    enabled: () => Boolean(settingsCommand.value),
    handler: () => settingsCommand.value?.run({ query: '' }),
  },
  {
    combo: 'Mod+Shift+K',
    description: 'Cycle Theme',
    group: 'Suite',
    enabled: canChangeTheme,
    allowInInput: true,
    allowInDialog: true,
    handler: cycleTheme,
  },
])

onScopeDispose(unregisterPaletteGroups)
</script>
