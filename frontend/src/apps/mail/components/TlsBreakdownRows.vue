<template>
  <!-- A short ranked table: who connected, how often, and how many of those sessions failed. -->
  <div v-if="rows.length" class="flex max-h-72 flex-col overflow-y-auto">
    <div
      v-for="row in rows"
      :key="row[labelKey]"
      class="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b px-5 py-3 text-sm last:border-b-0"
    >
      <span class="w-full break-all font-medium sm:w-auto sm:min-w-0 sm:flex-1">{{
        row[labelKey]
      }}</span>
      <span class="text-ink-gray-5 w-28 shrink-0 text-right tabular-nums">
        {{ __('{0} sessions', [row.sessions.toLocaleString()]) }}
      </span>
      <span v-if="row.failed" class="text-ink-gray-5 w-20 shrink-0 text-right tabular-nums">
        {{ __('{0} failed', [row.failed.toLocaleString()]) }}
      </span>
      <span v-else class="hidden w-20 shrink-0 sm:block" />
      <Badge
        class="w-14 shrink-0 justify-center"
        :theme="rateTheme(row.success_rate)"
        :label="formatRate(row.success_rate)"
      />
    </div>
  </div>
  <div v-else class="text-ink-gray-5 px-5 py-4 text-sm">{{ empty }}</div>
</template>

<script setup lang="ts">
import { Badge } from 'frappe-ui'

import { formatRate, rateTheme } from '@/apps/mail/utils/reports'
import type { TlsTotals } from '@/apps/mail/utils/tls'

type Row = TlsTotals & Record<string, string | number | null>

defineProps<{ rows: Row[]; labelKey: string; empty: string }>()
</script>
