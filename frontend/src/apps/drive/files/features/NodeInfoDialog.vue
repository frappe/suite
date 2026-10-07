<template>
  <Dialog v-model:open="open" title="Details" size="md">
    <div v-if="detail.status === 'pending' && !detail.data" class="space-y-3">
      <Skeleton v-for="index in 5" :key="index" class="h-5 w-full" />
    </div>
    <ErrorMessage
      v-else-if="!detail.data"
      :message="detail.error?.message ?? 'Could not load the details.'"
    />
    <dl v-else class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-base">
      <template v-for="field in fields" :key="field.label">
        <dt class="text-ink-gray-5">{{ field.label }}</dt>
        <dd class="truncate text-ink-gray-8" :title="field.value">{{ field.value }}</dd>
      </template>
    </dl>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, Skeleton } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'

import { formatBytes, formatDate } from '../internal/format'
import { nodeTypeLabel } from '../internal/icons'

/** Read-only facts about one node: type, size, location, owner and dates. */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const detail = useQuery(api.drive.nodes.get, () =>
  open.value && props.node ? { node: props.node, expand: 'access,breadcrumbs' } : false,
)

const fields = computed(() => {
  const row = detail.data
  if (!row) return []
  return [
    { label: 'Name', value: row.title },
    { label: 'Type', value: nodeTypeLabel(row) },
    ...(row.kind === 'file' ? [{ label: 'Size', value: formatBytes(row.size) }] : []),
    { label: 'Location', value: row.breadcrumbs?.map((crumb) => crumb.title).join(' / ') || '—' },
    { label: 'Owner', value: row.owner.full_name },
    { label: 'Created', value: formatDate(row.creation) },
    { label: 'Modified', value: formatDate(row.content_modified ?? row.modified) },
  ]
})
</script>
