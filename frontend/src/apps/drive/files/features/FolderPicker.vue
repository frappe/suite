<template>
  <Dialog v-model:open="open" :title="TITLES[mode]" size="lg">
    <div class="flex flex-col gap-4">
      <p v-if="description" class="text-p-base text-ink-gray-7">{{ description }}</p>
      <TabButtons v-if="rootOptions.length > 1" v-model="rootKind" :options="rootOptions" fluid />
      <div class="overflow-hidden rounded-6 border border-outline-gray-1">
        <div class="flex h-11 items-center gap-1 border-b border-outline-gray-1 pe-3 ps-1.5">
          <Button
            variant="ghost"
            icon="lucide-arrow-left"
            label="Back"
            :disabled="trail.length < 2"
            @click="openCrumb(trail.length - 2)"
          />
          <Breadcrumbs :items="crumbs" class="min-w-0 flex-1" />
        </div>
        <div
          ref="listElement"
          tabindex="-1"
          class="h-72 overflow-y-auto overscroll-contain p-1.5 focus-visible:outline-none"
          :aria-busy="folders.status === 'pending'"
        >
          <div v-if="folders.status === 'pending'" aria-hidden="true">
            <div v-for="width in SKELETON_WIDTHS" :key="width" class="flex h-11 items-center gap-2.5 px-2 sm:h-9">
              <Skeleton class="size-4 shrink-0 rounded-1" :class="SKELETON_BAR" />
              <Skeleton class="h-2 rounded-full" :class="[SKELETON_BAR, width]" />
            </div>
          </div>
          <div
            v-else-if="folders.error && !folders.rows.length"
            class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
          >
            <ErrorMessage :message="folders.error.message" />
            <Button label="Retry" :loading="folders.isFetching" @click="folders.refetch()" />
          </div>
          <p
            v-else-if="!folders.rows.length"
            class="flex h-full items-center justify-center px-4 text-center text-p-sm text-ink-gray-5"
          >
            No folders inside
          </p>
          <ul v-else :aria-label="`Folders in ${crumbs.at(-1)?.label ?? 'this folder'}`">
            <li v-for="folder in folders.rows" :key="folder.name">
              <button
                type="button"
                class="flex h-11 w-full items-center gap-2.5 rounded-4 px-2 text-start text-lg text-ink-gray-8 transition-colors hover:bg-surface-gray-2 active:bg-surface-gray-3 disabled:cursor-not-allowed disabled:text-ink-gray-4 disabled:hover:bg-transparent sm:h-9 sm:text-base"
                :disabled="!canOpenFolder(mode, items, folder.name)"
                @click="openFolder(folder)"
              >
                <span
                  class="size-4 shrink-0"
                  :class="[nodeIcon(folder), canOpenFolder(mode, items, folder.name) ? nodeIconTint(folder) : 'text-ink-gray-4']"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate" :title="folder.title">{{ folder.title }}</span>
                <span v-if="!canOpenFolder(mode, items, folder.name)" class="shrink-0 text-sm text-ink-gray-4">
                  Being moved
                </span>
                <span v-else class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4" aria-hidden="true" />
              </button>
            </li>
          </ul>
          <div v-if="folders.hasNext" class="flex justify-center p-2">
            <Button label="Load more folders" :loading="folders.isFetchingNext" @click="folders.fetchNext()" />
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-3">
        <p
          v-if="target.status === 'refused'"
          class="min-w-0 basis-full text-p-sm text-ink-gray-5 sm:flex-1 sm:basis-auto"
          role="status"
        >
          {{ target.reason }}
        </p>
        <Button label="Cancel" @click="open = false" />
        <Button
          variant="solid"
          theme="gray"
          :label="ACTIONS[mode]"
          :disabled="target.status !== 'allowed'"
          :loading="busy"
          @click="choose"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { Breadcrumbs, Button, Dialog, ErrorMessage, Skeleton, TabButtons } from 'frappe-ui'

import { children, node } from '@/apps/drive/client/nodes'
import { roots } from '@/apps/drive/client/roots'
import type { DriveAccess, DriveNode } from '@/apps/drive/client/types'
import { useQuery } from '@/platform/server-state'
import { nodeIcon, nodeIconTint } from '../internal/icons'
import { locationTitle } from '../internal/locations'
import { canOpenFolder, destination, type PickedItem, type PickerMode } from './folderPicker'

const props = withDefaults(defineProps<{
  mode: PickerMode
  /** The items the action places. A folder being moved cannot be opened, and items cannot move to where they are. */
  items?: readonly PickedItem[]
  /** Keeps the picker inside one root: its node. A restore must stay in its root. */
  root?: string
  description?: string
  /** The chosen action is running. */
  busy?: boolean
}>(), { items: () => [] })
const TITLES = { move: 'Move to', copy: 'Make a copy', restore: 'Restore to' } as const
const ACTIONS = { move: 'Move here', copy: 'Copy here', restore: 'Restore here' } as const
// The listing's skeleton look (FilesListing.vue).
const SKELETON_BAR = '!bg-surface-gray-2 motion-reduce:animate-none'
const SKELETON_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32']
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [node: string] }>()
const listElement = useTemplateRef<HTMLElement>('listElement')
const discovered = useQuery(roots())
const rootKind = ref<'personal' | 'organization'>('personal')
const trail = ref<Array<{ node: string; title: string; access?: DriveAccess }>>([])
const rootOptions = computed(() => [
  { value: 'personal', label: 'My files' },
  ...(discovered.data?.organization ? [{ value: 'organization', label: 'Organization files' }] : []),
].filter((option) => !props.root || discovered.data?.[option.value as 'personal' | 'organization']?.node === props.root))
watch(rootOptions, (options) => {
  const only = options.length === 1 ? options[0]!.value : null
  if (only === 'personal' || only === 'organization') rootKind.value = only
}, { immediate: true })
const root = computed(() => discovered.data?.[rootKind.value] ?? null)

// Keyed on the root's node: a refetch of the roots returns a new object, and
// must not send the user back to the top while they browse.
watch([() => root.value?.node, open], () => {
  if (open.value && root.value) trail.value = [{ ...root.value }]
}, { immediate: true })

const current = computed(() => trail.value.at(-1) ?? null)
const crumbs = computed(() => trail.value.map((crumb, index) => ({
  label: locationTitle({ name: crumb.node, title: crumb.title }, discovered.data),
  onClick: () => openCrumb(index),
})))
const folders = useQuery(() => current.value
  ? children({ node: current.value.node, types: ['folder'], expand: 'access', order_by: 'title', ascending: true })
  : false)
const currentDetail = useQuery(() => current.value ? node(current.value.node, 'access') : false)
const target = computed(() => current.value
  ? destination(props.mode, props.items, current.value.node, currentDetail.data?.access?.role ?? current.value.access?.role)
  : { status: 'unknown' as const })

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
function choose() {
  if (!current.value || target.value.status !== 'allowed' || props.busy) return
  emit('choose', current.value.node)
}
</script>
