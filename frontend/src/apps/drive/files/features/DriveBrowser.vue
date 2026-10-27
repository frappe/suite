<template>
  <div class="flex flex-col gap-4">
    <TabButtons v-if="rootOptions.length > 1" v-model="rootKind" :options="rootOptions" fluid />
    <div class="overflow-hidden rounded-6 border border-outline-gray-1">
      <div class="flex h-11 items-center gap-1 border-b border-outline-gray-1 pe-3 ps-1.5">
        <Button
          variant="ghost"
          icon="lucide-arrow-left"
          :label="__('Back')"
          :disabled="trail.length < 2"
          @click="openCrumb(trail.length - 2)"
        />
        <Breadcrumbs :items="crumbs" class="min-w-0 flex-1" />
      </div>
      <div
        ref="listElement"
        tabindex="-1"
        class="h-72 overflow-y-auto overscroll-contain p-1.5 focus-visible:outline-none"
        :aria-busy="rows.status === 'pending'"
      >
        <div v-if="rows.status === 'pending'" aria-hidden="true">
          <div
            v-for="width in SKELETON_WIDTHS"
            :key="width"
            class="flex h-11 items-center gap-2.5 px-2 sm:h-9"
          >
            <Skeleton class="size-4 shrink-0 rounded-1" :class="SKELETON_BAR" />
            <Skeleton class="h-2 rounded-full" :class="[SKELETON_BAR, width]" />
          </div>
        </div>
        <div
          v-else-if="rows.error && !rows.rows.length"
          class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
        >
          <ErrorMessage :message="rows.error.message" />
          <Button :label="__('Retry')" :loading="rows.isFetching" @click="rows.refetch()" />
        </div>
        <p
          v-else-if="!rows.rows.length"
          class="flex h-full items-center justify-center px-4 text-center text-p-sm text-ink-gray-5"
        >
          {{ emptyLabel }}
        </p>
        <ul v-else :aria-label="listLabel(location?.label ?? __('this folder'))">
          <li v-for="node in rows.rows" :key="node.name">
            <slot name="row" :node :open-folder="openFolder" />
          </li>
        </ul>
        <div v-if="rows.hasNext" class="flex justify-center p-2">
          <Button
            :label="__('Load more')"
            :loading="rows.isFetchingNext"
            @click="rows.fetchNext()"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Breadcrumbs, Button, ErrorMessage, Skeleton, TabButtons } from 'frappe-ui'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { api, useInfiniteQuery, useQuery } from '@/api'
import type { DriveAccess, DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { locationTitle } from '../internal/locations'

/** The folder a Drive picker shows. `label` is its name as the breadcrumbs show it. */
export interface BrowserLocation {
  node: string
  title: string
  label: string
  access?: DriveAccess
}

/** Browses the caller's Drive roots folder by folder, for a picker. Each row is the caller's slot. */
const props = withDefaults(
  defineProps<{
    /** The picker is open. Each time it opens, the browser goes back to its start. */
    active: boolean
    /** Keeps the browser inside one root: its node. */
    root?: string
    /** The root to open on, when the caller knows a better one than My files. */
    startRoot?: 'personal' | 'organization' | null
    /** The folder to open in, with the path down to it. */
    startFolder?: string | null
    /** The listing's `type` filter, such as `folder`. All types when unset. */
    type?: string
    /** Whether a folder on the path can be opened. */
    canOpen?: (folder: string) => boolean
    /** Shown when the folder has no rows. */
    emptyLabel: string
    /** The list's accessible name, from the folder's label. */
    listLabel: (folder: string) => string
  }>(),
  { startRoot: null, startFolder: null, type: undefined, canOpen: () => true },
)
const location = defineModel<BrowserLocation | null>('location', { default: null })

// The listing's skeleton look (FilesListing.vue).
const SKELETON_BAR = '!bg-surface-gray-2 motion-reduce:animate-none'
const SKELETON_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32']
const listElement = useTemplateRef<HTMLElement>('listElement')
const discovered = useQuery(api.drive.roots.list, {})
const rootKind = ref<'personal' | 'organization'>('personal')
const trail = ref<Array<{ node: string; title: string; access?: DriveAccess }>>([])
const rootOptions = computed(() =>
  [
    { value: 'personal', label: __('My files') },
    ...(discovered.data?.organization
      ? [{ value: 'organization', label: __('Organization files') }]
      : []),
  ].filter(
    (option) =>
      !props.root ||
      discovered.data?.[option.value as 'personal' | 'organization']?.node === props.root,
  ),
)
watch(
  rootOptions,
  (options) => {
    const only = options.length === 1 ? options[0]!.value : null
    if (only === 'personal' || only === 'organization') rootKind.value = only
  },
  { immediate: true },
)
watch(
  [() => props.active, () => props.startRoot],
  () => {
    if (props.active && !props.root) rootKind.value = props.startRoot ?? 'personal'
  },
  { immediate: true },
)
const selectedRoot = computed(() => discovered.data?.[rootKind.value] ?? null)

const start = useQuery(api.drive.nodes.get, () =>
  props.active && props.startFolder
    ? { node: props.startFolder, expand: 'access,breadcrumbs' }
    : false,
)
const startTrail = computed(() => {
  const folder = start.data
  if (!folder || folder.state !== 'Active' || folder.root !== selectedRoot.value?.node) return null
  const path = [
    ...(folder.breadcrumbs ?? []).map((crumb) => ({ node: crumb.name, title: crumb.title })),
    { node: folder.name, title: folder.title, access: folder.access },
  ]
  return path.every((crumb) => props.canOpen(crumb.node)) ? path : null
})

// Keyed on the root's node: a refetch of the roots returns a new object, and
// must not send the user back to the top while they browse.
watch(
  [() => selectedRoot.value?.node, () => props.active],
  () => {
    if (props.active && selectedRoot.value)
      trail.value = startTrail.value ?? [{ ...selectedRoot.value }]
  },
  { immediate: true },
)
// The starting folder can load after the picker opens. It replaces the top of
// the root only while the user is still there.
watch(
  () => startTrail.value?.map((crumb) => crumb.node).join('/'),
  () => {
    const path = startTrail.value
    if (
      props.active &&
      path &&
      trail.value.length === 1 &&
      trail.value[0]?.node === selectedRoot.value?.node
    )
      trail.value = path
  },
)

const crumbs = computed(() =>
  trail.value.map((crumb, index) => ({
    label: locationTitle({ name: crumb.node, title: crumb.title }, discovered.data),
    onClick: () => openCrumb(index),
  })),
)
watch(
  [trail, crumbs],
  () => {
    const crumb = trail.value.at(-1)
    location.value = crumb ? { ...crumb, label: crumbs.value.at(-1)?.label ?? crumb.title } : null
  },
  { immediate: true, deep: true },
)
const rows = useInfiniteQuery(api.drive.nodes.children, () =>
  location.value
    ? {
        node: location.value.node,
        ...(props.type && { type: props.type }),
        expand: 'access',
        order_by: 'title',
        ascending: true,
      }
    : false,
)

function openFolder(folder: DriveNode) {
  trail.value.push({ node: folder.name, title: folder.title, access: folder.access })
  focusList()
}
function openCrumb(index: number) {
  if (index < 0 || index >= trail.value.length - 1) return
  trail.value = trail.value.slice(0, index + 1)
  focusList()
}
/** The row or crumb the user clicked leaves the page, so focus goes to the new list. */
function focusList() {
  void nextTick(() => listElement.value?.focus())
}
</script>
