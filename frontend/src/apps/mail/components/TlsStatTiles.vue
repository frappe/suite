<template>
  <!-- Sessions, how many negotiated TLS, how many did not; the success rate alone carries a bar. -->
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
    <template v-if="tiles">
      <div v-for="tile in tiles" :key="tile.label" class="flex flex-col gap-1 rounded-4 border p-4">
        <span class="text-ink-gray-5 text-sm">{{ tile.label }}</span>
        <span class="text-ink-gray-9 text-xl font-semibold leading-7">{{ tile.value }}</span>
        <!-- A bar or a note, never both; the bar takes the note's line so tiles stay level. -->
        <div v-if="tile.bar !== undefined" class="flex h-4 items-center">
          <div class="bg-surface-gray-3 h-1 w-full rounded-full">
            <div
              class="bg-surface-gray-10 h-1 rounded-full"
              :style="{ width: `${Math.min(100, Math.max(2, tile.bar))}%` }"
            />
          </div>
        </div>
        <span v-else class="text-ink-gray-5 flex items-center gap-1 text-xs">
          <span
            v-if="tile.warn"
            class="lucide-triangle-alert size-3 shrink-0 text-ink-amber-6"
            aria-hidden="true"
          />
          {{ tile.sub || ' ' }}
        </span>
      </div>
    </template>
    <template v-else>
      <DashboardTileSkeleton v-for="n in 3" :key="n" :bar="n === 2" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { formatRate, RATE_WARN_BELOW, share } from '@/apps/mail/utils/reports'
import type { TlsTotals } from '@/apps/mail/utils/tls'
import { DashboardTileSkeleton } from '@/platform/dashboard'

const { totals } = defineProps<{ /** Absent while loading. */ totals?: TlsTotals }>()

const tiles = computed(() => {
  if (!totals) return undefined
  const { sessions, failed, reports, success_rate } = totals
  const warn = success_rate !== null && success_rate < RATE_WARN_BELOW
  return [
    {
      label: __('Sessions'),
      value: sessions.toLocaleString(),
      // A single report has no count of its own; the list page's totals do.
      sub: reports ? __('{0} reports', [reports.toLocaleString()]) : '',
    },
    {
      label: __('Negotiated TLS'),
      value: formatRate(success_rate),
      bar: success_rate ?? 0,
      warn,
    },
    {
      label: __('Failed Sessions'),
      value: failed.toLocaleString(),
      sub: sessions ? __('{0} of all sessions', [formatRate(share(failed, sessions))]) : '',
      warn: warn && failed > 0,
    },
  ]
})
</script>
