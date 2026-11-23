<script setup lang="ts">
import type { AppIcon } from './suiteApps'

defineProps<{ icon: AppIcon }>()
</script>

<template>
  <component :is="icon.component" v-if="'component' in icon" aria-hidden="true" />
  <span v-else :class="icon.className" aria-hidden="true" />
</template>
