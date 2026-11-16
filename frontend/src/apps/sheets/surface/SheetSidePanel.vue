<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'

import {
  DriveDocumentSidePanel,
  type DocumentComments,
  type DocumentPanel,
  type DocumentSession,
  type DocumentVersion,
} from '@/apps/drive'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { cellLabel, cellPlaces } from './commentPlaces'
import { readAnchor } from './records'

/** The spreadsheet's comments, on its cells or on all of it, and its versions, in the panel Writer and Slides use. */
const props = defineProps<{
  session: DocumentSession
  comments: DocumentComments
  /** The workbook's sheets, in order. */
  sheets: readonly string[]
  canComment: boolean
  canEditDocument: boolean
  /** Moves the editor to a cell; false when the cell is no longer there. */
  goToCell: (sheet: string, cell: string) => boolean
  isRestoringVersion: boolean
  /** Saves the spreadsheet's pending edits, throwing why it couldn't. */
  saveFirst: () => Promise<void>
}>()
const emit = defineEmits<{
  restoreVersion: [version: DocumentVersion]
  downloadVersion: [version: DocumentVersion]
  /** Escape over a shown version. */
  back: []
}>()
/** Which of the two shows; null hides the panel, which stays mounted so it can slide in and out. */
const panel = defineModel<DocumentPanel | null>('panel', { required: true })
/** The version the surface shows; a click in the list asks for another. */
const previewedVersion = defineModel<DocumentVersion | null>('previewedVersion', { required: true })

const sharedPanel = useTemplateRef('sharedPanel')
defineExpose({ reloadVersions: () => sharedPanel.value?.reloadVersions() })

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

// Escape goes on to the page, where the shared panel hears it to leave a shown version
function keepFromGrid(event: KeyboardEvent) {
  if (event.key !== 'Escape') {
    event.stopPropagation()
  }
}
</script>

<template>
  <!-- Keys and clicks in the panel stay out of the grid -->
  <div class="contents" @click.stop @keydown="keepFromGrid">
    <DriveDocumentSidePanel
      ref="sharedPanel"
      v-model:panel="panel"
      v-model:open-thread="openThread"
      v-model:previewed-version="previewedVersion"
      :session
      :comments
      :places
      :can-comment
      :can-edit-document
      :can-share="session.canShare.value"
      :can-restore-version="canEditDocument"
      :can-save-version="canEditDocument"
      :is-restoring-version
      :save-first
      noun="spreadsheet"
      :draft-label="__('Add a comment on the cell')"
      @restore-version="emit('restoreVersion', $event)"
      @download-version="emit('downloadVersion', $event)"
      @back="emit('back')"
    />
  </div>
</template>
