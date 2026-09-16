<template>
  <div class="flex h-screen flex-col bg-surface-base">
    <main class="min-h-0 flex-1 overflow-auto">
      <slot />
    </main>
    <!-- The suite is one PWA, so the offer to install it is the shell's, not
         an app's; it decides for itself when to show. -->
    <InstallPrompt v-if="isMobile" />
  </div>
</template>

<script setup lang="ts">
import { useScreenSize } from '@/composables/useScreenSize'
import InstallPrompt from '@/shell/InstallPrompt.vue'

const { isMobile } = useScreenSize()
</script>
