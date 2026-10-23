<!-- A user's storage at a glance: amount used, and against a limit a progress bar. Uncapped users get no bar, since there is nothing to fill. -->
<script setup lang="ts">
import { Progress } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

import { formatStorage, storageUsed } from './storageFormat'

const { user, showLimit = true } = defineProps<{
  user: { drive_bytes: number; mail_bytes: number | null; cap_bytes: number | null }
  /** Off where a separate column already shows the limit. */
  showLimit?: boolean
}>()

const used = computed(() => storageUsed(user))
const percent = computed(() =>
  user.cap_bytes ? Math.min(100, (used.value / user.cap_bytes) * 100) : 0,
)
</script>

<template>
  <div class="w-full min-w-0 space-y-1.5">
    <div class="flex items-baseline justify-between gap-2 text-p-sm">
      <span class="truncate text-ink-gray-8">{{ formatStorage(used) }}</span>
      <span v-if="showLimit" class="truncate text-ink-gray-5">
        {{
          user.cap_bytes === null ? __('No limit') : __('of {0}', [formatStorage(user.cap_bytes)])
        }}
      </span>
    </div>
    <Progress v-if="user.cap_bytes !== null" :value="percent" size="md" />
  </div>
</template>
