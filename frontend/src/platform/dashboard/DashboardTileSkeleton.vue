<!-- Placeholder for one stat tile: label, value, note and an optional bar. -->
<template>
  <div class="flex flex-col gap-1 rounded-4 border p-4" aria-hidden="true">
    <DashboardSkeletonText class="text-sm" width="55%" />
    <DashboardSkeletonText class="text-xl leading-7" width="35%" />
    <DashboardSkeletonText class="text-xs" width="45%" />
    <div v-if="bar" class="mt-1 h-1 w-full rounded-full bg-surface-gray-3" />
  </div>
</template>

<script setup lang="ts">
import DashboardSkeletonText from './DashboardSkeletonText.vue'

const { bar = false } = defineProps<{ bar?: boolean }>()
</script>
