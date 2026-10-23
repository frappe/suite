<!-- Placeholder matching DashboardDetailHeader: icon, title, meta line and actions. -->
<template>
  <div class="flex flex-wrap items-center gap-x-4 gap-y-3" aria-hidden="true">
    <Skeleton class="h-11 w-11 shrink-0 rounded-6" />
    <div class="min-w-0 flex-1">
      <DashboardSkeletonText class="text-lg leading-6" width="14rem" />
      <DashboardSkeletonText class="mt-1 text-sm" width="10rem" />
    </div>
    <div v-if="actions" class="flex shrink-0 items-center gap-2">
      <Skeleton v-for="n in actions" :key="n" class="h-7 w-16 rounded-4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

import { DashboardSkeletonText } from '@/platform/dashboard'

const { actions = 0 } = defineProps<{ actions?: number }>()
</script>
