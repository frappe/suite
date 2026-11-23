<!-- The share dialog's Copy link and Done, with who the link opens for. Holds its place while the item is unknown. -->
<template>
  <div class="flex items-center gap-3">
    <p v-if="address" class="min-w-0 flex-1 text-p-xs text-ink-gray-5">{{ caption }}</p>
    <p v-else-if="placeholders" class="min-w-0 flex-1 text-p-xs" aria-hidden="true">
      <Skeleton class="inline-block h-3 w-32 align-middle" />
    </p>
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Button
        v-if="address"
        icon-left="lucide-link"
        :label="__('Copy link')"
        @click="copyLink(address)"
      />
      <Skeleton v-else-if="placeholders" class="h-7 w-28" aria-hidden="true" />
      <Button variant="ghost" :label="__('Done')" @click="emit('done')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Button, Skeleton } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

import { copyLink } from './shareFormat'

defineProps<{ address: string | null; caption: string; placeholders: boolean }>()
const emit = defineEmits<{ done: [] }>()
</script>
