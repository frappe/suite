<template>
  <Dialog v-model:open="open" title="Details" size="md">
    <div v-if="detail.status === 'pending' && !detail.data" class="space-y-3">
      <Skeleton v-for="index in 5" :key="index" class="h-5 w-full" />
    </div>
    <ErrorMessage
      v-else-if="!detail.data"
      :message="detail.error?.message ?? 'Could not load the details.'"
    />
    <div v-else>
      <div class="flex items-center gap-3">
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-5 bg-surface-gray-2"
          aria-hidden="true"
        >
          <span :class="[nodeIcon(detail.data), nodeIconTint(detail.data), 'size-5']" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="break-words text-lg-semibold text-ink-gray-8">{{ detail.data.title }}</p>
          <p class="mt-1 text-sm text-ink-gray-5">{{ summary }}</p>
        </div>
      </div>
      <dl
        class="mt-5 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-outline-gray-1 pt-5 text-base"
      >
        <template v-for="field in fields" :key="field.label">
          <dt class="text-ink-gray-5">{{ field.label }}</dt>
          <dd class="break-words text-ink-gray-8">{{ field.value }}</dd>
        </template>
      </dl>
    </div>
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
import { nodeIcon, nodeIconTint, useNodeTypeLabel } from '../internal/icons'
import { useLocationTitle } from '../internal/locations'
import { sharedWith } from './share/shareModel'

/**
 * Read-only facts about one node: its name and type (and size) on top, then
 * location, owner, dates and, for someone who may share it, who else can open
 * it. Reading grants takes MANAGE (Drive spec §11.2), so other callers see no
 * sharing line.
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
  return [{ label: 'Shared with', value: names.join(', ') || 'Not shared' }]
})

const typeLabel = useNodeTypeLabel()
const locationTitle = useLocationTitle()

const summary = computed(() => {
  const row = detail.data
  if (!row) return ''
  const type = typeLabel(row)
  return row.kind === 'file' ? `${type} · ${formatBytes(row.size)}` : type
})

const fields = computed<Array<{ label: string; value: string }>>(() => {
  const row = detail.data
  if (!row) return []
  return [
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
