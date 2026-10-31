<template>
  <!-- Product tab bodies import this path; the shell body does the work. -->
  <SettingsTabContent v-bind="$attrs">
    <slot />
  </SettingsTabContent>
</template>

<script setup lang="ts">
import SettingsTabContent from '@/shell/settings/SettingsTabContent.vue'

defineOptions({ inheritAttrs: false })
</script>
