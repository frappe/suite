<template>
  <Dialog v-model:open="open" :title="title ?? __('Choose a file')" size="lg">
    <div class="flex flex-col gap-4">
      <DriveBrowser
        :active="open"
        :empty-label="__('Nothing in this folder')"
        :list-label="(name) => __('Files in {0}', [name])"
        @update:location="picked = null"
      >
        <template #row="{ node, openFolder }">
          <button
            type="button"
            class="flex h-11 w-full items-center gap-2.5 rounded-4 px-2 text-start text-lg text-ink-gray-8 transition-colors hover:bg-surface-gray-2 active:bg-surface-gray-3 aria-pressed:bg-surface-gray-3 sm:h-9 sm:text-base"
            :aria-pressed="node.kind === 'folder' ? undefined : picked?.name === node.name"
            @click="node.kind === 'folder' ? openFolder(node) : (picked = node)"
            @dblclick="node.kind !== 'folder' && choose(node)"
          >
            <span
              class="size-4 shrink-0"
              :class="[nodeIcon(node), nodeIconTint(node)]"
              aria-hidden="true"
            />
            <span class="min-w-0 flex-1 truncate" :title="node.title">{{ node.title }}</span>
            <span
              v-if="node.kind === 'folder'"
              class="lucide-chevron-right size-4 shrink-0 text-ink-gray-4"
              aria-hidden="true"
            />
            <span v-else class="shrink-0 text-sm text-ink-gray-5">{{
              __(nodeTypeLabel(node))
            }}</span>
          </button>
        </template>
      </DriveBrowser>
      <div class="flex items-center justify-end gap-2">
        <Button :label="__('Cancel')" @click="open = false" />
        <Button
          variant="solid"
          theme="gray"
          :label="action ?? __('Choose')"
          :disabled="!picked"
          @click="picked && choose(picked)"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { Button, Dialog } from 'frappe-ui'
import { ref, watch } from 'vue'

import type { DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

import { nodeIcon, nodeIconTint, nodeTypeLabel } from '../internal/icons'
import DriveBrowser from './DriveBrowser.vue'

/** Picks one file or document from the caller's Drive. Folders open; anything else is picked. */
defineProps<{ title?: string; action?: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ choose: [node: DriveNode] }>()
const picked = ref<DriveNode | null>(null)
watch(open, () => (picked.value = null))

function choose(node: DriveNode) {
  emit('choose', node)
  open.value = false
}
</script>
