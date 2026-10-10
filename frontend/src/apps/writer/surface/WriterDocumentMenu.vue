<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { Button, Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed, ref } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { listTabs } from '@/apps/writer/extensions/tabs'
import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { downloadDocx, downloadMarkdown, exportHTML, type ExportScope } from './exports'

/**
 * The Writer document's menu in the Drive header: download as DOCX or
 * Markdown, and, with edit access, import a DOCX into the open document. A
 * document with tabs asks in a submenu whether to download the open tab or all
 * of them.
 */
const props = defineProps<{
  session: Pick<DocumentSession, 'nodeId' | 'title' | 'credentials'>
  editor: Editor | null
  settings: Record<string, unknown>
  /** The person may change the body. Importing needs it. */
  editable: boolean
}>()

const DOCX_TYPES = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Read when the menu opens: the editor's document is not reactive. */
const hasTabs = ref(false)

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

const options = computed<DropdownOptions>(() => {
  const title = props.session.title.value
  const downloads = {
    group: __('Download'),
    hideLabel: true,
    options: [
      downloadOption(__('Download as DOCX'), 'lucide-file-text', (html) =>
        downloadDocx(html, title, props.settings, props.session.credentials.fetch),
      ),
      downloadOption(__('Download as Markdown'), 'lucide-pilcrow', (html) =>
        downloadMarkdown(html, title, props.session.credentials.fetch),
      ),
    ],
  }
  if (!props.editable) return [downloads]
  return [
    downloads,
    {
      group: __('Import'),
      hideLabel: true,
      options: [{ label: __('Import DOCX'), icon: 'lucide-file-up', onClick: pickDocx }],
    },
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
  <Dropdown :options="options" align="end" @update:open="noteTabs">
    <Button
      variant="ghost"
      icon="lucide-ellipsis"
      :tooltip="__('More document actions')"
      :aria-label="__('More document actions')"
      :disabled="!editor"
    />
  </Dropdown>
</template>
