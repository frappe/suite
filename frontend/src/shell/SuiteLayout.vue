<template>
  <div class="flex h-screen flex-col bg-surface-base">
    <main class="min-h-0 flex-1 overflow-auto">
      <slot />
    </main>
    <SuiteCommandPalette />
  </div>
</template>

<script setup lang="ts">
import SuiteCommandPalette from './SuiteCommandPalette.vue'
</script>
