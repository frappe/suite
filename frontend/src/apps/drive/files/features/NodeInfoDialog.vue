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
        <dd
          :class="['text-ink-gray-8', field.wraps ? 'break-words' : 'truncate']"
          :title="field.value"
        >
          {{ field.value }}
        </dd>
      </template>
    </dl>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, ErrorMessage, Skeleton } from 'frappe-ui'
import { computed } from 'vue'

import { api, useQuery } from '@/api'
import { grantListOf } from '@/apps/drive/client/grants'
import { canManage } from '@/apps/drive/client/types'
import { useWorkspace } from '@/platform/workspace'

import { formatBytes, formatDate } from '../internal/format'
import { useNodeTypeLabel } from '../internal/icons'
import { useLocationTitle } from '../internal/locations'
import { sharedWith } from './share/shareModel'

/**
 * Read-only facts about one node: type, size, location, owner, dates and, for
 * someone who may share it, who else can open it. Reading grants takes MANAGE
 * (Drive spec §11.2), so other callers see no sharing line.
 */
const props = defineProps<{ node: string }>()
const open = defineModel<boolean>('open', { required: true })
const detail = useQuery(api.drive.nodes.get, () =>
  open.value && props.node ? { node: props.node, expand: 'access,breadcrumbs' } : false,
)

const grants = useQuery(api.drive.grants.list, () =>
  open.value && props.node && canManage(detail.data)
    ? { node: props.node, inherited: true }
    : false,
)
const { workspaceName: workspace } = useWorkspace()
const sharing = computed(() => {
  const row = detail.data
  if (!row || !grants.data) return []
  const names = sharedWith(grantListOf(grants.data), row.kind, workspace.value)
  return [{ label: 'Shared with', value: names.join(', ') || 'Not shared', wraps: true }]
})

const typeLabel = useNodeTypeLabel()
const locationTitle = useLocationTitle()

const fields = computed<Array<{ label: string; value: string; wraps?: boolean }>>(() => {
  const row = detail.data
  if (!row) return []
  return [
    { label: 'Name', value: row.title },
    { label: 'Type', value: typeLabel(row) },
    ...(row.kind === 'file' ? [{ label: 'Size', value: formatBytes(row.size) }] : []),
    {
      label: 'Location',
      value: row.breadcrumbs?.map((crumb) => locationTitle(crumb)).join(' / ') || '—',
    },
    { label: 'Owner', value: row.owner.full_name },
    { label: 'Created', value: formatDate(row.creation) },
    { label: 'Modified', value: formatDate(row.content_modified ?? row.modified) },
    ...sharing.value,
  ]
})
</script>
