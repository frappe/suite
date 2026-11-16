<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  DriveDocumentSidePanel,
  type DocumentComments,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { cellLabel, cellPlaces } from './commentPlaces'
import { readAnchor } from './records'

/** The spreadsheet's comments, on its cells or on all of it, in the panel Writer and Slides use. */
const props = defineProps<{
  /** Whether the panel shows; it stays mounted so it can slide in and out. */
  open: boolean
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

const shown = computed<DocumentPanel | null>({
  get: () => (props.open ? 'comments' : null),
  set: (panel) => {
    if (!panel) {
      emit('close')
    }
  },
})

// The shared panel lists versions too, which Sheets still shows in its own panel
const noVersions = {
  canRestoreVersion: false,
  canSaveVersion: false,
  isRestoringVersion: false,
  previewedVersion: null,
  saveFirst: async () => {},
}

const openThread = ref<string | null>(null)
const places = computed(() => cellPlaces(props.comments.threads.value, props.sheets))

const openedThread = computed(() =>
  props.comments.threads.value.find((shown) => shown.name === openThread.value),
)

// An opened thread takes the editor to its cell, once it's in the list
watch(
  () => openedThread.value?.name,
  () => {
    const thread = openedThread.value
    if (!thread) {
      return
    }

    const cell = readAnchor(thread.anchor)
    if (cell && !props.goToCell(cell.sheet, cell.cell)) {
      toast.info(__('{0} is no longer in this spreadsheet', [cellLabel(cell)]))
    }
  },
)
</script>

<template>
  <!-- Keys and clicks in the panel stay out of the grid -->
  <div class="contents" @click.stop @keydown.stop>
    <DriveDocumentSidePanel
      v-model:panel="shown"
      v-model:open-thread="openThread"
      :session
      :comments
      :places
      :can-comment
      :can-edit-document
      :can-share="session.canShare.value"
      v-bind="noVersions"
      noun="spreadsheet"
      :draft-label="__('Add a comment on the cell')"
    />
  </div>
</template>
