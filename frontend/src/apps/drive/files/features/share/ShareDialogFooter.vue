<!-- The share dialog's Copy link and Done. Holds its place while the item is unknown. -->
<template>
  <div class="flex items-center justify-between gap-2">
    <div v-if="address" class="min-w-0">
      <Button icon-left="lucide-link" :label="__('Copy link')" @click="copyLink(address)" />
      <p class="mt-1.5 text-p-xs text-ink-gray-5">{{ caption }}</p>
    </div>
    <div v-else-if="placeholders" class="min-w-0" aria-hidden="true">
      <Skeleton class="h-7 w-28" />
      <p class="mt-1.5 text-p-xs"><Skeleton class="inline-block h-3 w-32 align-middle" /></p>
    </div>
    <Button class="ml-auto" variant="ghost" :label="__('Done')" @click="emit('done')" />
  </div>
</template>

<script setup lang="ts">
import { Button, Skeleton } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import { copyLink } from './shareFormat'

defineProps<{ address: string | null; caption: string; placeholders: boolean }>()
const emit = defineEmits<{ done: [] }>()
</script>
