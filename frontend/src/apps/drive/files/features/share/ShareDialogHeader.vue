<!-- The item the share dialog is for. Holds its place while the item is unknown. -->
<template>
  <div v-if="node" class="mb-6 flex items-center gap-2.5">
    <span :class="[nodeIcon(node), 'size-5 shrink-0', nodeIconTint(node)]" aria-hidden="true" />
    <p class="min-w-0 break-words text-p-base-medium text-ink-gray-8">{{ node.title }}</p>
  </div>
  <div v-else-if="placeholders" class="mb-6 flex items-center gap-2.5" aria-hidden="true">
    <Skeleton class="size-5 shrink-0" />
    <p class="text-p-base-medium"><Skeleton class="inline-block h-4 w-48 align-middle" /></p>
  </div>
</template>

<script setup lang="ts">
import { Skeleton } from 'frappe-ui'

import type { DriveNode } from '@/apps/drive/client/types'

import { nodeIcon, nodeIconTint } from '../../internal/icons'

defineProps<{ node: DriveNode | null; placeholders: boolean }>()
</script>
