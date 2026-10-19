<template>
  <!-- Picks files out of Drive for another product to use, as the folder picker picks a folder:
       the user's own files or the organization's, browsed folder by folder. Only files can be
       picked; documents and links are shown, greyed, so a folder doesn't look emptier than it is. -->
  <Dialog v-model:open="open" :title="title ?? __('Choose files')" size="lg">
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
          :aria-busy="children.status === 'pending'"
        >
          <div v-if="children.status === 'pending'" aria-hidden="true">
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
            v-else-if="children.error && !children.rows.length"
            class="flex h-full flex-col items-center justify-center gap-3 px-4 text-center"
          >
            <ErrorMessage :message="children.error.message" />
            <Button
              :label="__('Retry')"
              :loading="children.isFetching"
              @click="children.refetch()"
            />
          </div>
          <p
            v-else-if="!children.rows.length"
            class="flex h-full items-center justify-center px-4 text-center text-p-sm text-ink-gray-5"
          >
            {{ __('Nothing in this folder') }}
          </p>
          <ul v-else :aria-label="crumbs.at(-1)?.label">
            <li v-for="node in children.rows" :key="node.name">
              <button
                type="button"
                class="flex h-11 w-full items-center gap-2.5 rounded-4 px-2 text-start text-lg text-ink-gray-8 transition-colors hover:bg-surface-gray-2 active:bg-surface-gray-3 disabled:cursor-not-allowed disabled:text-ink-gray-4 disabled:hover:bg-transparent sm:h-9 sm:text-base"
                :class="{ 'bg-surface-gray-2': isPicked(node) }"
                :disabled="!isFolder(node) && !isFile(node)"
                :aria-pressed="isFile(node) ? isPicked(node) : undefined"
                @click="isFolder(node) ? openFolder(node) : toggle(node)"
              >
                <Checkbox
                  v-if="isFile(node)"
                  :model-value="isPicked(node)"
                  class="pointer-events-none"
                  tabindex="-1"
                  aria-hidden="true"
                />
                <span
                  class="size-4 shrink-0"
                  :class="[
                    nodeIcon(node),
                    isFolder(node) || isFile(node) ? nodeIconTint(node) : '',
                  ]"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate" :title="node.title">{{ node.title }}</span>
                <span v-if="isFile(node)" class="shrink-0 text-sm text-ink-gray-5">{{
                  formatBytes(node.size)
                }}</span>
                <span
                  v-else-if="isFolder(node)"
                  class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4"
                  aria-hidden="true"
                />
              </button>
            </li>
          </ul>
          <div v-if="children.hasNext" class="flex justify-center p-2">
            <Button
              :label="__('Load more')"
              :loading="children.isFetchingNext"
              @click="children.fetchNext()"
            />
          </div>
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-x-2 gap-y-3">
        <p
          v-if="picked.length"
          class="min-w-0 basis-full text-p-sm text-ink-gray-5 sm:flex-1 sm:basis-auto"
          role="status"
        >
          {{ __('{0} selected', [String(picked.length)]) }}
        </p>
        <Button :label="__('Cancel')" @click="open = false" />
        <Button
          variant="solid"
          theme="gray"
          :label="action ?? __('Choose')"
          :disabled="!picked.length"
          @click="choose"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import {
  Breadcrumbs,
  Button,
  Checkbox,
  Dialog,
  ErrorMessage,
  Skeleton,
  TabButtons,
} from 'frappe-ui'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'

import { api, useInfiniteQuery, useQuery } from '@/api'
import type { DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { formatBytes } from '../internal/format'
import { nodeIcon, nodeIconTint } from '../internal/icons'
import { locationTitle } from '../internal/locations'
import type { PickedFile } from './filePicker'

const { title, action } = defineProps<{
  /** The dialog's title; "Choose files" by default. */
  title?: string
  /** The button that takes the picked files, naming what is done with them. */
  action?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ picked: [files: PickedFile[]] }>()

// The listing's skeleton look (FilesListing.vue).
const SKELETON_BAR = '!bg-surface-gray-2 motion-reduce:animate-none'
const SKELETON_WIDTHS = ['w-40', 'w-28', 'w-48', 'w-32']

const listElement = useTemplateRef<HTMLElement>('listElement')
const discovered = useQuery(api.drive.roots.list, {})
const rootKind = ref<'personal' | 'organization'>('personal')
const trail = ref<Array<{ node: string; title: string }>>([])
const rootOptions = computed(() => [
  { value: 'personal', label: __('My files') },
  ...(discovered.data?.organization
    ? [{ value: 'organization', label: __('Organization files') }]
    : []),
])
const root = computed(() => discovered.data?.[rootKind.value] ?? null)
// Kept across folders and roots: picking from two folders is one choice.
const picked = ref<PickedFile[]>([])

watch(
  [() => root.value?.node, open],
  () => {
    if (open.value && root.value) trail.value = [{ node: root.value.node, title: root.value.title }]
  },
  { immediate: true },
)

const current = computed(() => trail.value.at(-1) ?? null)
const crumbs = computed(() =>
  trail.value.map((crumb, index) => ({
    label: locationTitle({ name: crumb.node, title: crumb.title }, discovered.data),
    onClick: () => openCrumb(index),
  })),
)
const children = useInfiniteQuery(api.drive.nodes.children, () =>
  current.value ? { node: current.value.node, order_by: 'title', ascending: true } : false,
)

const isFolder = (node: DriveNode) => node.kind === 'folder'
const isFile = (node: DriveNode) => node.kind === 'file'
const isPicked = (node: DriveNode) => picked.value.some((file) => file.node === node.name)

function toggle(node: DriveNode) {
  picked.value = isPicked(node)
    ? picked.value.filter((file) => file.node !== node.name)
    : [...picked.value, { node: node.name, title: node.title, size: node.size }]
}
function openFolder(folder: DriveNode) {
  trail.value.push({ node: folder.name, title: folder.title })
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
  if (!picked.value.length) return
  emit('picked', picked.value)
  open.value = false
}
</script>
