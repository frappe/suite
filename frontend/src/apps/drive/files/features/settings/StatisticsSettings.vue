<!--
  How much the caller's personal Drive holds, against its quota, and what
  those bytes are: totals by type and the largest items, both named as a
  Drive listing shows them. One request answers all three, so the tab loads
  once, and every state shares one layout.
-->
<template>
  <!-- The server folds a document's media into the document, so every listed
       item is one Drive shows. The description says so: those bytes are real. -->
  <SettingsPage
    :title="__('Statistics')"
    :description="__('Pictures and videos inside a document count towards that document.')"
  >
    <div class="flex flex-col gap-6">
      <div class="flex flex-col gap-2">
        <Progress :value="percent" size="md" :aria-label="__('Storage used')" />
        <p class="text-base text-ink-gray-7">{{ summary }}</p>
      </div>

      <div class="grid gap-6 border-t pt-6 sm:grid-cols-2">
        <!-- Each list has a fixed box, the height of the largest-files cap,
             so loading, loaded, empty and failed all take the same space and
             no heading moves between them. -->
        <section class="flex min-w-0 flex-col gap-2">
          <h3 class="text-base font-semibold text-ink-gray-8">{{ __('By type') }}</h3>
          <div class="h-80 overflow-y-auto">
            <ul v-if="byType.length" class="flex flex-col">
              <li v-for="row in byType" :key="row.type" class="flex h-8 items-center gap-2">
                <span
                  :class="[storageTypeIcon(row.type), storageTypeTint(row.type)]"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="flex-1 truncate text-base text-ink-gray-8">{{ __(row.type) }}</span>
                <span class="text-base text-ink-gray-7 tabular-nums">{{
                  formatBytes(row.bytes)
                }}</span>
              </li>
            </ul>
            <p v-else-if="data" class="py-2 text-p-sm text-ink-gray-5">{{ emptyText }}</p>
            <div v-else-if="!failed" class="flex flex-col" aria-hidden="true">
              <div v-for="n in 3" :key="n" class="flex h-8 items-center gap-2">
                <Skeleton class="size-4 shrink-0" />
                <Skeleton class="h-3.5 flex-1" />
                <Skeleton class="h-3.5 w-14" />
              </div>
            </div>
          </div>
        </section>

        <section class="flex min-w-0 flex-col gap-2">
          <h3 class="text-base font-semibold text-ink-gray-8">{{ __('Largest files') }}</h3>
          <div class="h-80 overflow-y-auto">
            <ul v-if="largest.length" class="flex flex-col">
              <li v-for="file in largest" :key="file.node" class="flex h-8 items-center gap-2">
                <span
                  :class="[storageTypeIcon(file.type), storageTypeTint(file.type)]"
                  class="size-4 shrink-0"
                  aria-hidden="true"
                />
                <span class="flex-1 truncate text-base text-ink-gray-8" :title="file.title">
                  {{ file.title }}
                </span>
                <span class="text-base text-ink-gray-7 tabular-nums">{{
                  formatBytes(file.size)
                }}</span>
              </li>
            </ul>
            <p v-else-if="data" class="py-2 text-p-sm text-ink-gray-5">{{ __('No files') }}</p>
            <div v-else-if="!failed" class="flex flex-col" aria-hidden="true">
              <div v-for="n in 3" :key="n" class="flex h-8 items-center gap-2">
                <Skeleton class="size-4 shrink-0" />
                <Skeleton class="h-3.5 flex-1" />
                <Skeleton class="h-3.5 w-14" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Progress, Skeleton } from 'frappe-ui'
import { computed } from 'vue'

import { roots } from '@/apps/drive/client/roots'
import { rootStorage } from '@/apps/drive/client/settings'
import { formatBytes } from '@/apps/drive/files/internal/format'
import { useQuery } from '@/platform/server-state'
import { translate as __ } from '@/platform/translation'

import SettingsPage from './SettingsPage.vue'
import { storageTypeIcon, storageTypeTint } from './storageTypes'

const discovered = useQuery(roots())
const usage = useQuery(() => {
  const personal = discovered.data?.personal.node
  return personal ? rootStorage(personal) : null
})

const failed = computed(() => discovered.status === 'error' || usage.status === 'error')
const data = computed(() => usage.data)
const byType = computed(() => data.value?.by_type ?? [])
const largest = computed(() => data.value?.largest ?? [])

// Used bytes with no active file behind them are trash and versions, which
// still count towards storage.
const emptyText = computed(() =>
  (data.value?.used_bytes ?? 0) > 0
    ? __('No active files. Files in the trash and their versions still count towards storage.')
    : __('No files'),
)

const percent = computed(() => {
  const answer = data.value
  if (!answer || answer.effective_quota <= 0) return 0
  return Math.min(100, Math.round((answer.used_bytes / answer.effective_quota) * 100))
})

const summary = computed(() => {
  // One line in every state, so nothing moves when the totals arrive.
  if (failed.value) return __('Storage use could not load.')
  const answer = data.value
  if (!answer) return __('Loading…')
  const used = formatBytes(answer.used_bytes)
  if (answer.effective_quota <= 0) return __('{0} used', [used])
  return __('{0} of {1} used', [used, formatBytes(answer.effective_quota)])
})
</script>
