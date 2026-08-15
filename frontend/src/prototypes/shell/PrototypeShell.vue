<!--
  The decided workspace shell (icon rail + contextual panel), on the throwaway
  /prototype/shell route.

  PROTOTYPE — remove. Fake data only (see fixtures.ts); no persistence.
-->
<template>
  <div class="flex h-full min-h-0 flex-col bg-surface-base">
    <ShellLayout />
    <CommandPalette />
  </div>
</template>

<script setup lang="ts">
import CommandPalette from './CommandPalette.vue'
import ShellLayout from './VariantB.vue'
</script>
