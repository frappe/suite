<script setup lang="ts">
import { Button } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

import { DriveCommentList, type DocumentComments, type DocumentSession } from '@/apps/drive'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { cellLabel, cellPlaces } from './commentPlaces'
import { readAnchor } from './records'

/** The spreadsheet's comments, on its cells or on all of it, over the grid's right edge. */
const props = defineProps<{
  session: DocumentSession
  comments: DocumentComments
  /** The workbook's sheets, in order. */
  sheets: readonly string[]
  canComment: boolean
  canEditDocument: boolean
  /** Moves the editor to a cell; false when the cell is no longer there. */
  goToCell: (sheet: string, cell: string) => boolean
}>()
const emit = defineEmits<{ close: [] }>()

const openThread = ref<string | null>(null)
const places = computed(() => cellPlaces(props.comments.threads.value, props.sheets))

// An opened thread takes the editor to its cell
watch(openThread, (name) => {
  const thread = props.comments.threads.value.find((shown) => shown.name === name)
  if (!thread) {
    return
  }

  const cell = readAnchor(thread.anchor)
  if (cell && !props.goToCell(cell.sheet, cell.cell)) {
    toast.info(__('{0} is no longer in this spreadsheet', [cellLabel(cell)]))
  }
})
</script>

<template>
  <aside
    class="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-outline-gray-2 bg-surface-base text-ink-gray-8 shadow-xl"
    :aria-label="__('Comments')"
    @click.stop
    @keydown.stop
  >
    <header
      class="flex min-h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 pl-4 pr-2"
    >
      <h2 class="text-lg-semibold">{{ __('Comments') }}</h2>
      <Button
        icon="lucide-x"
        variant="ghost"
        :aria-label="__('Close comments')"
        @click="emit('close')"
      />
    </header>
    <div class="min-h-0 flex-1 overflow-y-auto p-2 pb-10">
      <DriveCommentList
        v-model:open-thread="openThread"
        :threads="comments.threads.value"
        :read-at="comments.readAt.value"
        :node="session.nodeId"
        :places
        :can-comment
        :can-edit-document
        :can-share="session.canShare.value"
        :actions="comments.actions"
        :drafts="comments.drafts"
        noun="spreadsheet"
        :draft-label="__('Add a comment on the cell')"
      />
    </div>
  </aside>
</template>
