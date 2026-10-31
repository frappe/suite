<!-- Placeholder with the same frame as SiteStorageSummary: title, total, bar and legend. -->
<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

import { DashboardSkeletonText } from '@/platform/dashboard'
import { translate as __ } from '@/platform/translation'

const { action = false } = defineProps<{ action?: boolean }>()
</script>

<template>
  <section class="space-y-4 rounded-5 border border-outline-gray-2 p-4 sm:p-5" aria-hidden="true">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg-medium text-ink-gray-9">{{ __('Where storage goes') }}</h2>
      <Skeleton v-if="action" class="h-7 w-28 rounded-4" />
    </div>
    <div class="space-y-3">
      <DashboardSkeletonText class="text-p-sm" width="9rem" />
      <div class="h-2.5 rounded-full bg-surface-gray-2" />
      <div class="flex flex-wrap gap-x-6 gap-y-2">
        <DashboardSkeletonText v-for="n in 3" :key="n" class="flex-none text-sm" width="7rem" />
      </div>
    </div>
  </section>
</template>
