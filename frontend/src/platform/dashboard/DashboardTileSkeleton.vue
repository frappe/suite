<!-- Placeholder for one stat tile: label, value, then a note or a bar. -->
<template>
  <div class="flex flex-col gap-1 rounded-4 border p-4" aria-hidden="true">
    <DashboardSkeletonText class="text-sm" width="55%" />
    <DashboardSkeletonText class="text-xl leading-7" width="35%" />
    <div v-if="bar" class="flex h-4 items-center">
      <div class="h-1 w-full rounded-full bg-surface-gray-3" />
    </div>
    <DashboardSkeletonText v-else class="text-xs" width="45%" />
  </div>
</template>

<script setup lang="ts">
import DashboardSkeletonText from './DashboardSkeletonText.vue'

const { bar = false } = defineProps<{ bar?: boolean }>()
</script>
