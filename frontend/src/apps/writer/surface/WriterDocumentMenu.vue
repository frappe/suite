<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Button, Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { listTabs } from '@/apps/writer/extensions/tabs'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { downloadDocx, downloadMarkdown, exportHTML, type ExportScope } from './exports'
import { waitForFocusBack } from './focusBack'

/**
 * The Writer document's menu in the Drive header: download as DOCX or
 * Markdown, and, with edit access, lock the document or import a DOCX into it. A
 * document with tabs asks in a submenu whether to download the open tab or all
 * of them.
 */
const props = defineProps<{
  session: Pick<DocumentSession, 'nodeId' | 'title' | 'credentials'>
  editor: Editor | null
  settings: Record<string, unknown>
  /** The person may change the body. Importing needs it. */
  editable: boolean
  canSaveVersion: boolean
  /** The person could edit the body if it weren't locked. Locking needs it. */
  canLock: boolean
  isLocked: boolean
}>()

const emit = defineEmits<{ saveVersion: []; setLocked: [lock: boolean] }>()

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
    toast.error(__('Could not download this document.'))
  }
}

function downloadOption(label: string, icon: string, save: Download) {
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

function documentOptions() {
  const lock = props.isLocked
    ? {
        label: __('Unlock document'),
        icon: 'lucide-lock-open',
        onClick: () => emit('setLocked', false),
      }
    : {
        label: __('Lock document'),
        icon: 'lucide-lock',
        onClick: () => emit('setLocked', true),
      }
  return [
    ...(props.canSaveVersion
      ? [{ label: __('Save version'), icon: 'lucide-bookmark', onClick: pickVersion }]
      : []),
    ...(props.canLock ? [lock] : []),
  ]
}

function fileOptions() {
  const title = props.session.title.value
  return [
    downloadOption(__('Download as DOCX'), 'lucide-file-text', (html) =>
      downloadDocx(html, title, props.settings, props.session.credentials.fetch),
    ),
    downloadOption(__('Download as Markdown'), 'lucide-file-code', (html) =>
      downloadMarkdown(html, title, props.session.credentials.fetch),
    ),
    ...(props.editable
      ? [{ label: __('Import DOCX'), icon: 'lucide-file-up', onClick: pickDocx }]
      : []),
  ]
}

const options = computed<DropdownOptions>(() => {
  const groups = [
    { group: __('Document'), hideLabel: true, options: documentOptions() },
    { group: __('File'), hideLabel: true, options: fileOptions() },
  ]
  return groups.filter((group) => group.options.length > 0)
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
  <Dropdown :options="options" align="end" @update:open="noteTabs">
    <Button
      variant="ghost"
      icon="lucide-ellipsis"
      :tooltip="__('More document actions')"
      :aria-label="__('More document actions')"
      :disabled="!editor"
      @focus="saveVersionOnFocusBack"
    />
  </Dropdown>
</template>
