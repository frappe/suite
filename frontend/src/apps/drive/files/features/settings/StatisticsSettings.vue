<!--
  How much the caller's personal Drive holds, against its quota. Totals only:
  the per-kind breakdown waits on Drive issue 41.
-->
<template>
  <SettingsPage :title="__('Statistics')">
    <p v-if="failed" class="text-base text-ink-gray-6">
      {{ __('Storage use could not load. Reload the page and try again.') }}
    </p>
    <div v-else class="flex flex-col gap-2">
      <Progress :value="percent" size="md" :aria-label="__('Storage used')" />
      <p class="text-base text-ink-gray-7">{{ summary }}</p>
    </div>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Progress } from 'frappe-ui'

import { roots } from '@/apps/drive/client/roots'
import { rootUsage } from '@/apps/drive/client/settings'
import { formatBytes } from '@/apps/drive/files/internal/format'
import { useQuery } from '@/platform/server-state'
import { translate as __ } from '@/platform/translation'
import SettingsPage from './SettingsPage.vue'

const discovered = useQuery(roots())
const usage = useQuery(() => {
  const personal = discovered.data?.personal.node
  return personal ? rootUsage(personal) : null
})

const failed = computed(() => discovered.status === 'error' || usage.status === 'error')

const percent = computed(() => {
  const data = usage.data
  if (!data || data.effective_quota <= 0) return 0
  return Math.min(100, Math.round((data.used_bytes / data.effective_quota) * 100))
})

const summary = computed(() => {
  const data = usage.data
  // Same line height while loading, so nothing moves when the totals arrive.
  if (!data) return __('Loading…')
  const used = formatBytes(data.used_bytes)
  if (data.effective_quota <= 0) return __('{0} used', [used])
  return __('{0} used of {1}', [used, formatBytes(data.effective_quota)])
})
</script>
