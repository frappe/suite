<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { computed, ref } from 'vue'

import {
  DriveDocumentMenu,
  waitForFocusBack,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import { listTabs } from '@/apps/writer/extensions/tabs'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { downloadDocx, downloadMarkdown, exportHTML, type ExportScope } from './exports'

/**
 * What Writer adds to the document menu in the Drive header: save a version,
 * export as DOCX or Markdown, and, with edit access, lock the document or
 * import a DOCX into it. A document with tabs asks in a submenu whether to
 * export the open tab or all of them.
 */
const props = defineProps<{
  session: DocumentSession
  editor: Editor | null
  settings: Record<string, unknown>
  /** The person may change the body. Importing needs it. */
  editable: boolean
  canSaveVersion: boolean
  /** The person could edit the body if it weren't locked. Locking needs it. */
  canLock: boolean
  isLocked: boolean
  /** The side panels this person can open, and the one open now. */
  panels?: readonly DocumentPanel[]
  panel?: DocumentPanel | null
}>()

const emit = defineEmits<{
  saveVersion: []
  setLocked: [lock: boolean]
  togglePanel: [panel: DocumentPanel]
}>()

const DOCX_TYPES = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Read when the menu opens: the editor's document is not reactive. */
const hasTabs = ref(false)
/** Save version goes once the closing menu has handed focus back to its button. */
const focusBack = waitForFocusBack()

function noteTabs(open: boolean) {
  if (open && props.editor) {
    hasTabs.value = listTabs(props.editor).length > 1
  }
}

type Download = (html: string) => Promise<void>

async function download(save: Download, scope: ExportScope) {
  if (!props.editor) return
  try {
    await save(exportHTML(props.editor, scope))
  } catch (error) {
    console.error(error)
    toast.error(__('Could not export this document.'))
  }
}

function exportOption(label: string, save: Download) {
  const icon = 'lucide-download'
  if (!hasTabs.value) return { label, icon, onClick: () => void download(save, 'document') }
  return {
    label,
    icon,
    submenu: [
      { label: __('Current tab'), onClick: () => void download(save, 'tab') },
      { label: __('All tabs'), onClick: () => void download(save, 'document') },
    ],
  }
}

function pickVersion() {
  focusBack.wait(() => emit('saveVersion'))
}

// After the menu's own focus return, so the name box keeps the focus
function saveVersionOnFocusBack() {
  focusBack.focused()
}

const own = computed(() => {
  const isLocked = props.isLocked
  const lock = {
    label: isLocked ? __('Unlock document') : __('Lock document'),
    icon: isLocked ? 'lucide-lock-open' : 'lucide-lock',
    onClick: () => emit('setLocked', !isLocked),
  }
  return [
    ...(props.canSaveVersion
      ? [{ label: __('Save version'), icon: 'lucide-bookmark', onClick: pickVersion }]
      : []),
    ...(props.canLock ? [lock] : []),
  ]
})

const transfer = computed(() => {
  const title = props.session.title.value
  return [
    exportOption(__('Export as DOCX'), (html) =>
      downloadDocx(html, title, props.settings, props.session.credentials.fetch),
    ),
    exportOption(__('Export as Markdown'), (html) =>
      downloadMarkdown(html, title, props.session.credentials.fetch),
    ),
    ...(props.editable
      ? [{ label: __('Import DOCX'), icon: 'lucide-upload', onClick: pickDocx }]
      : []),
  ]
})

/** The picker input is never in the page, so the header holds one input: the title. */
function pickDocx() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = DOCX_TYPES
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) void importFile(file)
  })
  input.click()
}

/**
 * An empty document takes the imported content; any other gets it in a new
 * tab, so nothing already written changes. The importer reports the outcome.
 */
async function importFile(file: File) {
  const editor = props.editor
  if (!editor || !props.editable) return
  const { importDocx } = await import('@/apps/writer/utils/docximporter')
  await importDocx(file, { editor: { value: editor }, currentFileId: props.session.nodeId })
}
</script>

<template>
  <DriveDocumentMenu
    :session="session"
    :panels="panels"
    :panel="panel"
    :own="own"
    :transfer="transfer"
    :disabled="!editor && !panels?.length"
    @toggle-panel="emit('togglePanel', $event)"
    @open="noteTabs"
    @focus-back="saveVersionOnFocusBack"
  />
</template>
