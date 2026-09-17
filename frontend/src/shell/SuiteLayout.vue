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
import SuiteCommandPalette from './SuiteCommandPalette.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import InstallPrompt from '@/shell/InstallPrompt.vue'
import { useRootStore } from '@/stores/root'
import { resolvedTheme, switchTheme } from '@/utils/setupTheme'

const root = useRootStore()
const { isMobile } = useScreenSize()

const unregisterPaletteGroups = root.registerPaletteGroups('suite-layout', computed(() => [
  {
    commands: [
      {
        id: 'suite-toggle-theme',
        label: `Switch to ${resolvedTheme.value === 'dark' ? 'light' : 'dark'} mode`,
        enterHint: `switch to ${resolvedTheme.value === 'dark' ? 'light' : 'dark'} mode`,
        icon: resolvedTheme.value === 'dark' ? 'lucide-sun' : 'lucide-moon',
        keywords: ['appearance', 'color scheme', 'theme'],
        run: () => switchTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark'),
      },
    ],
  },
]))

onScopeDispose(unregisterPaletteGroups)
</script>
