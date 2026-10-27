<!-- Placeholder rows inside a DashboardCard. Pass the row classes the real rows use so
     each placeholder takes the same height. -->
<template>
  <div class="flex flex-col" aria-hidden="true">
    <div v-for="row in rows" :key="row" :class="rowClass">
      <DashboardSkeletonText :width="`${40 + ((row * 17) % 35)}%`" />
    </div>
  </div>
</template>

<script setup lang="ts">
import DashboardSkeletonText from './DashboardSkeletonText.vue'

const { rows = 3, rowClass = 'border-b px-5 py-3 text-base last:border-b-0' } = defineProps<{
  rows?: number
  rowClass?: string
}>()
</script>
