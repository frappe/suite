<template>
  <!-- One headline number per check; the pass rate shows a bar in place of its note. -->
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
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
      <DashboardTileSkeleton v-for="n in 5" :key="n" :bar="n === 2" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import type { DmarcTotals } from '@/apps/mail/utils/dmarc'
import { formatRate, RATE_WARN_BELOW, share } from '@/apps/mail/utils/reports'
import { DashboardTileSkeleton } from '@/platform/dashboard'

const { totals } = defineProps<{ /** Absent while loading. */ totals?: DmarcTotals }>()

const tiles = computed(() => {
  if (!totals) return undefined
  const { messages, failed, dkim_passed, spf_passed, reports, pass_rate } = totals
  const warn = pass_rate !== null && pass_rate < RATE_WARN_BELOW
  return [
    {
      label: __('Messages'),
      value: messages.toLocaleString(),
      sub: __('{0} reports', [reports.toLocaleString()]),
    },
    {
      label: __('Passed DMARC'),
      value: formatRate(pass_rate),
      bar: pass_rate ?? 0,
      warn,
    },
    {
      label: __('Passed DKIM'),
      value: formatRate(share(dkim_passed, messages)),
      sub: __('{0} messages', [dkim_passed.toLocaleString()]),
    },
    {
      label: __('Passed SPF'),
      value: formatRate(share(spf_passed, messages)),
      sub: __('{0} messages', [spf_passed.toLocaleString()]),
    },
    {
      label: __('Failed DMARC'),
      value: failed.toLocaleString(),
      sub: messages ? __('{0} of all messages', [formatRate(share(failed, messages))]) : '',
      warn: warn && failed > 0,
    },
  ]
})
</script>
