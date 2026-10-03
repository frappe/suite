<template>
  <!-- Product tab bodies import this path; the shell header does the work. -->
  <SettingsTabHeader v-bind="$attrs">
    <template v-if="$slots.default" #default>
      <slot />
    </template>
    <template v-if="$slots.actions" #actions>
      <slot name="actions" />
    </template>
  </SettingsTabHeader>
</template>

<script setup lang="ts">
import SettingsTabHeader from '@/shell/settings/SettingsTabHeader.vue'

defineOptions({ inheritAttrs: false })
</script>
