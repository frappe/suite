<!--
  Drive > Storage: how much the caller's personal Drive holds, against its
  quota, and what those bytes are: totals by type and the largest items, both
  named as a Drive listing shows them. One request answers all three, so the
  tab shows one loading state and then everything at once.
-->
<template>
  <SettingsPage
    :title="__('Storage')"
    :description="__('How much space your files use, and what uses it')"
    :loading="!failed && !data"
  >
    <LoadFailed
      v-if="failed"
      variant="section"
      :title="__('Could not load storage usage')"
      :retry="retry"
    />
    <template v-else-if="data">
      <SettingsSection>
        <div class="flex flex-col gap-2 py-3.5">
          <Progress :value="percent" size="md" :aria-label="__('Storage used')" />
          <p class="text-base text-ink-gray-7">{{ summary }}</p>
        </div>
      </SettingsSection>

      <SettingsSection :title="__('By type')">
        <div v-for="row in data.by_type" :key="row.type" class="flex h-10 items-center gap-2">
          <span
            :class="[storageTypeIcon(row.type), storageTypeTint(row.type)]"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="flex-1 truncate text-base text-ink-gray-8">{{ __(row.type) }}</span>
          <span class="text-base text-ink-gray-7 tabular-nums">{{ formatBytes(row.bytes) }}</span>
        </div>
        <p v-if="!data.by_type.length" class="py-3.5 text-p-base text-ink-gray-6">
          {{ emptyText }}
        </p>
      </SettingsSection>

      <!-- The server folds a document's media into the document, so every listed
           item is one Drive shows. The description says so: those bytes are real. -->
      <SettingsSection
        :title="__('Largest files')"
        :description="__('Pictures and videos inside a document count towards that document.')"
      >
        <div v-for="file in data.largest" :key="file.node" class="flex h-10 items-center gap-2">
          <span
            :class="[storageTypeIcon(file.type), storageTypeTint(file.type)]"
            class="size-4 shrink-0"
            aria-hidden="true"
          />
          <span class="flex-1 truncate text-base text-ink-gray-8" :title="file.title">
            {{ file.title }}
          </span>
          <span class="text-base text-ink-gray-7 tabular-nums">{{ formatBytes(file.size) }}</span>
        </div>
        <p v-if="!data.largest.length" class="py-3.5 text-p-base text-ink-gray-6">
          {{ __('No files') }}
        </p>
      </SettingsSection>
    </template>
  </SettingsPage>
</template>

<script setup lang="ts">
import { Progress } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { formatBytes } from '@/apps/drive/files/internal/format'
import { LoadFailed } from '@/platform/load-failed'
import { SettingsPage, SettingsSection } from '@/platform/settings-tab'
import { translate as __ } from '@/platform/translation'

import { storageTypeIcon, storageTypeTint } from './storageTypes'

const discovered = useQuery(api.drive.roots.list, {})
const usage = useQuery(api.drive.roots.usage, () => {
  const personal = discovered.data?.personal.node
  return personal ? { root: personal, expand: 'breakdown' } : false
})

async function retry() {
  if (discovered.error) await discovered.refetch()
  await usage.refetch()
}

const failed = computed(() => discovered.status === 'error' || usage.status === 'error')
const data = computed(() => {
  const answer = usage.data
  return answer && { ...answer, by_type: answer.by_type ?? [], largest: answer.largest ?? [] }
})

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
  const answer = data.value
  if (!answer) return ''
  const used = formatBytes(answer.used_bytes)
  if (answer.effective_quota <= 0) return __('{0} used', [used])
  return __('{0} of {1} used', [used, formatBytes(answer.effective_quota)])
})
</script>
