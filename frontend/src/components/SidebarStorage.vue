<template>
  <!-- The storage block at the foot of an app sidebar: a cloud row, then the
	     meter. One meter in both states — its bar narrows with the rail and rides
	     the sidebar's width transition rather than being swapped out. -->
  <div class="flex flex-col gap-2 rounded-4 p-2">
    <!-- h-5 holds the row at the label's line height once the label is gone. -->
    <div class="flex h-5 items-center gap-2">
      <Cloud class="size-4 shrink-0" :stroke-width="1.5" />
      <span v-if="!collapsed" class="text-sm">{{ __('Storage') }}</span>
    </div>
    <StorageMeter :used-percentage :label :limited :collapsed />
  </div>
</template>

<script setup lang="ts">
import { Cloud } from 'lucide-vue-next'

import StorageMeter from '@/components/StorageMeter.vue'

const {
  usedPercentage,
  label,
  limited = true,
  collapsed = false,
} = defineProps<{
  usedPercentage: number
  label: string
  limited?: boolean
  collapsed?: boolean
}>()
</script>
