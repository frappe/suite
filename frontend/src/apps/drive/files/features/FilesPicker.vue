<template>
  <!-- Picks files out of Drive for another product to copy, such as mail attachments. Only files
       can be picked; documents and links are shown, greyed, so a folder doesn't look emptier
       than it is. FilePicker.vue picks one file or document instead. -->
  <Dialog v-model:open="open" :title="title ?? __('Choose files')" size="lg">
    <div class="flex flex-col gap-4">
      <DriveBrowser
        :active="open"
        :empty-label="__('Nothing in this folder')"
        :list-label="(name) => __('Files in {0}', [name])"
      >
        <template #row="{ node, openFolder }">
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
              :class="[nodeIcon(node), isFolder(node) || isFile(node) ? nodeIconTint(node) : '']"
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
        </template>
      </DriveBrowser>
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
import { Button, Checkbox, Dialog } from 'frappe-ui'
import { ref, watch } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { formatBytes } from '../internal/format'
import { nodeIcon, nodeIconTint } from '../internal/icons'
import DriveBrowser from './DriveBrowser.vue'
import type { PickedFile } from './filePicker'

defineProps<{
  /** The dialog's title; "Choose files" by default. */
  title?: string
  /** The button that takes the picked files, naming what is done with them. */
  action?: string
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ picked: [files: PickedFile[]] }>()

// Kept across folders and roots: picking from two folders is one choice.
const picked = ref<PickedFile[]>([])
watch(open, () => (picked.value = []))

const isFolder = (node: DriveNode) => node.kind === 'folder'
const isFile = (node: DriveNode) => node.kind === 'file'
const isPicked = (node: DriveNode) => picked.value.some((file) => file.node === node.name)

function toggle(node: DriveNode) {
  picked.value = isPicked(node)
    ? picked.value.filter((file) => file.node !== node.name)
    : [...picked.value, { node: node.name, title: node.title, size: node.size }]
}
function choose() {
  if (!picked.value.length) return
  emit('picked', picked.value)
  open.value = false
}
</script>
