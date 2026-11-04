<!--
  How much of the personal Drive's quota is used, as a thin bar and one line.
  Pressing it opens the Statistics tab in Settings. It keeps its space with a
  skeleton while it loads, and shows nothing when the read fails.
-->
<template>
  <button
    v-if="meter"
    type="button"
    class="group flex w-full flex-col gap-2 rounded-4 px-2 py-2 text-start transition-colors hover:bg-surface-gray-3 focus-visible:focus-ring"
    :aria-label="__('Storage: {0}. Open storage settings.', [meter.label])"
    @click="openSettings('drive.statistics')"
  >
    <!-- The track darkens with the hover background, so it stays visible on it. -->
    <span
      v-if="meter.percent !== null"
      class="h-1 w-full overflow-hidden rounded-full bg-surface-gray-3 transition-colors group-hover:bg-surface-gray-4"
    >
      <span
        class="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
        :class="FILL[meter.level]"
        :style="{ width: `${meter.percent}%` }"
      />
    </span>
    <span class="text-xs text-ink-gray-5 tabular-nums">{{ meter.label }}</span>
  </button>
  <div v-else-if="!failed" class="flex flex-col gap-2 px-2 py-2" aria-hidden="true">
    <Skeleton class="h-1 w-full rounded-full" />
    <Skeleton class="h-3 w-28" />
  </div>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { openSettings } from '@/platform/settings'
import { translate as __ } from '@/platform/translation'

import { storageMeter, type StorageLevel } from './storageMeter'

const FILL: Record<StorageLevel, string> = {
  ok: 'bg-surface-gray-7',
  near: 'bg-surface-amber-6',
  full: 'bg-surface-red-6',
}

const discovered = useQuery(api.drive.roots.list, {})
const usage = useQuery(api.drive.roots.usage, () => {
  const personal = discovered.data?.personal.node
  return personal ? { root: personal } : false
})
const failed = computed(() => discovered.status === 'error' || usage.status === 'error')
const meter = computed(() => (usage.data ? storageMeter(usage.data) : null))
</script>
