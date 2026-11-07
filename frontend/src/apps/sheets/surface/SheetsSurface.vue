<script setup lang="ts">
import { dialog, toast } from 'frappe-ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'

import {
  DriveDocumentHeader,
  driveNodeRoute,
  type DocumentPanel,
  type DocumentSession,
} from '@/apps/drive'
import type { ChangedCell } from '@/apps/sheets/collab/changes'
import SheetEditor from '@/apps/sheets/components/SheetEditor/index.vue'
import { useHideRail } from '@/platform/rail'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { createSheetAccess } from './access'
import { useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import type { CellAnchor, SheetVersion } from './records'
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from './recovery'
import SheetCommentsPanel from './SheetCommentsPanel.vue'
import SheetVersionBar from './SheetVersionBar.vue'
import SheetVersionsPanel from './SheetVersionsPanel.vue'
import {
  copyFromVersion,
  errorText,
  fetchVersion,
  nextStep,
  readPreview,
  useVersionList,
  versionTitle,
  type VersionPreview,
} from './versions'

/** What the surface reads from the editor it mounts (`defineExpose`). */
interface SheetEditorHandle {
  readonly activeCell: string
  readonly currentSheet: string
  readonly saveState: DocumentSaveState
  flushSave(): Promise<void>
  /** The workbook, with the cell edit still in progress. */
  workbookJson(): Promise<string>
  /** True while the formula bar or the cell editor holds uncommitted text. */
  hasDraft(): boolean
  /** Live room: this tab holds edits that have not reached the server (other tabs' do not count). */
  hasUnsentWork(): boolean
  goToCell(sheet: string, cell: string): boolean
  closeNotes(): void
  /** True while the editor shows its load-error page instead of the sheet. */
  readonly hasLoadError: boolean
  /** True while the sheet is in a live room (collab on). */
  readonly isCollab: boolean
  /** Restores a version through the live room; rejects with the message to show. */
  restoreVersion(seq: string, bytes: Uint8Array): Promise<string>
  /** Live room: access went or came back. `mayEdit` is read once the room has sent what it could. */
  loseAccess(lost: 'lost_edit' | 'lost_read'): Promise<void>
  regainAccess(mayEdit: () => boolean): Promise<void>
  /** Resolves once the workbook has loaded, or failed to. */
  whenLoaded(): Promise<void>
  /** The live room's doc as one Yjs update; null outside a room. */
  docState(): Uint8Array | null
  /** Washes the cells a previewed version changed; null clears them. */
  showChanges(cells: readonly ChangedCell[] | null): void
}
const props = defineProps<{
  session: DocumentSession
}>()
const editor = ref<SheetEditorHandle | null>(null)
const panel = ref<DocumentPanel | null>(null)
// A restore, or edit access coming back, reloads the server workbook: the
// editor remounts under a new key.
const bodyRevision = ref(0)
const restoring = ref(false)
const hasRecovery = ref(readRecovery(props.session.nodeId) !== null)
// The editor stays mounted while it writes the recovery copy, even once read
// access is gone: unmounting stops the engine the copy is read from.
const copying = ref(false)
// The "Download my changes" toast, closed once the copy it offers is gone.
let offer: ReturnType<typeof toast.warning> | null = null
const access = createSheetAccess(props.session, {
  narrowed() {
    const current = editor.value
    // Live room: it sends what it can and keeps the rest on this device, and
    // its strip says the sheet is now view only. Edits that did not reach the
    // server, and text still being typed in a cell, are offered as a download
    // too: the room replays its copy only if edit access comes back. The copy
    // is taken first, while the cell edit is still open.
    if (current?.isCollab) {
      if (current.hasUnsentWork() || current.hasDraft()) void keepForDownload()
      void current.loseAccess(access.readable.value ? 'lost_edit' : 'lost_read')
      return
    }
    const unsaved = current !== null && (current.saveState !== 'clean' || current.hasDraft())
    if (!unsaved) {
      toast.warning(__('Editing access changed. This spreadsheet is now view only.'))
      return
    }
    void keepForDownload()
  },
  widened() {
    if (editor.value?.isCollab) {
      void editor.value.regainAccess(() => access.writable.value)
      toast.info(__('You can edit this spreadsheet again.'))
      return
    }
    bodyRevision.value += 1
    toast.info(__('You can edit this spreadsheet again.'))
  },
})
// A version shown read-only in place of the sheet (the live room closes meanwhile).
const preview = shallowRef<VersionPreview | null>(null)
const previewStep = ref<number | null>(null)
// The live room's doc when the first preview opened: each version is compared with it.
let liveState: Uint8Array | null = null
const versionList = useVersionList(props.session)
const account = useSession()
const canCopy = computed(
  () => props.session.folder.value !== null && account.status.value === 'authenticated',
)
const editorKey = computed(() =>
  preview.value ? `version-${preview.value.version.seq}` : `sheet-${bodyRevision.value}`,
)
const editorWritable = computed(
  () => access.writable.value && !restoring.value && preview.value === null,
)
useHideRail(() => access.readable.value && !editor.value?.hasLoadError)
const cursor = computed<CellAnchor | null>(() =>
  editor.value
    ? {
        sheet: editor.value.currentSheet,
        cell: editor.value.activeCell,
      }
    : null,
)

// A save that lands with edit access makes the recovery copy stale.
watch(
  () => editor.value?.saveState,
  (now, before) => {
    if (before !== 'saving' || now !== 'clean' || !access.writable.value || !hasRecovery.value)
      return
    clearRecovery(props.session.nodeId)
    hasRecovery.value = false
    if (offer !== null) toast.dismiss(offer)
    offer = null
  },
)

/** Comments, Versions and Notes share the right edge: one closes the others. */
function showPanel(next: DocumentPanel | null) {
  panel.value = next
  if (next) editor.value?.closeNotes()
}
// The list is read each time the panel opens; closing it ends a preview.
watch(panel, (now) => {
  if (now === 'versions') void versionList.load()
  else void leavePreview()
})
// A preview's editor washes the cells its version changed once it has loaded.
watch(editor, async (current) => {
  const shown = preview.value
  if (!current || !shown) return
  await current.whenLoaded()
  if (editor.value === current) current.showChanges(shown.changes)
})

async function previewVersion(version: SheetVersion | null) {
  if (!version) return leavePreview()
  if (preview.value?.version.seq === version.seq) return
  try {
    if (!preview.value) {
      // The sheet closes while a version is shown: its edits are saved first.
      await flushEdits()
      liveState = editor.value?.docState() ?? null
    }
    const bytes = await fetchVersion(props.session, version.seq)
    preview.value = await readPreview(version, bytes, liveState)
    previewStep.value = null
  } catch (error) {
    toast.error(errorText(error, __('This version could not be shown.')))
  }
}
/** Back to the sheet as it is now; resolves once its editor has loaded. */
async function leavePreview() {
  if (!preview.value) return
  preview.value = null
  liveState = null
  await nextTick()
  await editor.value?.whenLoaded()
}
function stepThroughChanges(delta: 1 | -1) {
  const changes = preview.value?.changes ?? []
  previewStep.value = nextStep(previewStep.value, delta, changes.length)
  const target = previewStep.value === null ? undefined : changes[previewStep.value]
  if (target) editor.value?.goToCell(target.sheet, target.cell)
}
function renameVersion(version: SheetVersion) {
  dialog.prompt({
    title: version.label ? __('Rename version') : __('Name this version'),
    fields: [
      {
        name: 'label',
        label: __('Name'),
        defaultValue: version.label ?? '',
        placeholder: __('Before the Q3 import'),
      },
    ],
    confirmLabel: __('Save'),
    onConfirm: async ({ values }) => {
      const named = await versionList.rename(version, String(values.label ?? '').trim())
      if (preview.value?.version.seq === named.seq)
        preview.value = { ...preview.value, version: named }
    },
  })
}
function confirmRestore(version: SheetVersion) {
  dialog.confirm({
    title: __('Restore this version?'),
    message: __(
      'The spreadsheet goes back to this version. Its current state is kept as a new version first.',
    ),
    confirmLabel: __('Restore'),
    onConfirm: async () => {
      await restoreVersion(version.seq)
      toast.success(__('Version restored'))
      await versionList.load()
    },
  })
}
function makeCopy(version: SheetVersion) {
  const folder = props.session.folder.value
  if (!folder) return
  dialog.prompt({
    title: __('Make a copy'),
    fields: [
      {
        name: 'title',
        label: __('Name'),
        required: true,
        defaultValue: `${props.session.title.value} (${versionTitle(version)})`,
      },
    ],
    confirmLabel: __('Make a copy'),
    onConfirm: async ({ values }) => {
      const shown = preview.value?.version.seq === version.seq ? preview.value.bytes : null
      const bytes = shown ?? (await fetchVersion(props.session, version.seq))
      const title = String(values.title ?? '').trim()
      const copy = await copyFromVersion(props.session, folder.name, bytes, title)
      toast.success(__('Copy made'), {
        action: {
          label: __('Open'),
          onClick: () => openInNewTab(copy),
        },
      })
    },
  })
}
function openInNewTab(node: { name: string; title: string }) {
  window.open(driveNodeRoute(node.name, node.title).path, '_blank', 'noopener')
}
function selectAnchor(anchor: CellAnchor) {
  if (!editor.value?.goToCell(anchor.sheet, anchor.cell)) {
    toast.info(`${anchor.sheet} · ${anchor.cell} is no longer in this spreadsheet.`)
  }
}

/** Save pending edits, or refuse: a version holds only the saved state. */
async function flushEdits() {
  await editor.value?.flushSave()
  if (editor.value && editor.value.saveState !== 'clean') {
    throw new Error(
      'Your latest changes are not saved yet. Try again when the spreadsheet is saved.',
    )
  }
}
async function restoreVersion(seq: string) {
  await leavePreview()
  await flushEdits()
  restoring.value = true
  try {
    // Live room: the restore goes in as one edit everyone's editor applies.
    if (editor.value?.isCollab) {
      const response = await props.session.credentials.fetch(props.session.versions.contentUrl(seq))
      if (!response.ok) throw new Error(__('The version could not be read.'))
      await editor.value.restoreVersion(seq, new Uint8Array(await response.arrayBuffer()))
      return
    }
    await props.session.versions.restore(seq)
    bodyRevision.value += 1
  } finally {
    restoring.value = false
  }
}
// Keeps the editor's workbook in this browser and offers it as a download.
async function keepForDownload() {
  if (!(await retainRecovery())) return
  if (offer !== null) toast.dismiss(offer)
  offer = toast.warning(
    __('Editing access changed. Your unsaved changes are kept on this device.'),
    {
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: __('Download my changes'),
        onClick: downloadChanges,
      },
    },
  )
}
/** True once the copy is kept. The workbook is read before the first await, while a cell edit is still open. */
async function retainRecovery(): Promise<boolean> {
  const reading = editor.value?.workbookJson()
  if (!reading) return false
  copying.value = true
  try {
    keepRecovery(props.session.nodeId, await reading)
    hasRecovery.value = true
    return true
  } catch {
    toast.error('Your latest changes could not be kept on this device.')
    return false
  } finally {
    copying.value = false
  }
}
async function downloadChanges() {
  try {
    const downloaded = await downloadRecovery(props.session.nodeId, props.session.title.value)
    hasRecovery.value = false
    if (!downloaded) toast.error('No recovery copy is kept for this spreadsheet.')
  } catch {
    toast.error('Your changes could not be downloaded. They are still kept on this device.')
  }
}
useDocumentLeaveGuard({
  state: () => editor.value?.saveState ?? 'clean',
  flush: async () => {
    await editor.value?.flushSave()
  },
  retainRecovery: async () => {
    await retainRecovery()
  },
})
</script>

<template>
  <div class="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface-base">
    <div
      v-if="!access.readable.value && !copying"
      class="flex h-full flex-col items-center justify-center px-6 text-center"
    >
      <span class="lucide-lock-keyhole size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">
        You no longer have permission to read this spreadsheet.
      </p>
    </div>
    <SheetEditor
      v-else
      :id="session.contentDocname"
      :key="editorKey"
      ref="editor"
      :writable="editorWritable"
      :title="session.title.value"
      :request-context="session.credentials.context"
      :collab-session="preview ? undefined : session"
      :version="preview?.bytes"
      @reopen="bodyRevision += 1"
      @notes-opened="panel = null"
    >
      <template
        #header="{ viewOnly, status: EditorStatus, menus: EditorMenus, actions: EditorActions }"
      >
        <DriveDocumentHeader
          class="sheets-header"
          :session="session"
          title-label="Spreadsheet title"
          :save-state="editor?.saveState ?? null"
          :view-only="viewOnly"
          :recoverable="hasRecovery"
          :panels="session.panels.value"
          :panel="panel"
          layout="compact"
          @update:panel="showPanel"
          @download-changes="downloadChanges"
        >
          <template #status>
            <component :is="EditorStatus" />
          </template>
          <template #menus>
            <component
              :is="EditorMenus"
              :open-comments="
                session.panels.value.includes('comments') ? () => showPanel('comments') : null
              "
            />
          </template>
          <template #actions>
            <component :is="EditorActions" />
          </template>
        </DriveDocumentHeader>
      </template>

      <template v-if="preview" #banner>
        <SheetVersionBar
          :preview="preview"
          :step="previewStep"
          :writable="access.writable.value"
          :can-copy="canCopy"
          :restoring="restoring"
          @exit="leavePreview"
          @step="stepThroughChanges"
          @rename="renameVersion(preview.version)"
          @copy="makeCopy(preview.version)"
          @restore="confirmRestore(preview.version)"
        />
      </template>

      <template #side-panel>
        <SheetCommentsPanel
          v-if="panel === 'comments'"
          :session="session"
          :cursor="cursor"
          :can-comment="access.canComment.value"
          @close="panel = null"
          @select="selectAnchor"
        />
        <SheetVersionsPanel
          v-else-if="panel === 'versions'"
          :session="session"
          :list="versionList"
          :writable="access.writable.value"
          :can-copy="canCopy"
          :previewed="preview?.version.seq ?? null"
          :flush="flushEdits"
          @close="panel = null"
          @preview="previewVersion"
          @rename="renameVersion"
          @copy="makeCopy"
          @restore="confirmRestore"
        />
      </template>
    </SheetEditor>
  </div>
</template>

<style scoped>
:deep(.sn-root) {
  height: 100%;
  min-height: 0;
}

/* The editor's menu bar answers to the `sn-topbar` container: below 640 px
   its six menus fold into one. */
.sheets-header {
  container: sn-topbar / inline-size;
  /* The bars' colours live on the editor root (SheetEditor.css --sn-bar-*). */
  background: var(--sn-bar-bg);
  border-bottom-color: var(--sn-bar-line);
  position: relative;
  z-index: 10;
}
/* Hover and "on" fills (Comments and Versions open) follow the bar colours,
   as in row 2; solid buttons such as Share keep their own. */
.sheets-header :deep(button:not(:disabled, .bg-surface-gray-10):hover),
.sheets-header :deep(button[data-state='open']),
.sheets-header :deep(button[aria-pressed='true']) {
  background: var(--sn-bar-hover);
}
.sheets-header :deep(button[aria-pressed='true']) {
  box-shadow: inset 0 0 0 1px var(--sn-bar-on-edge);
}
/* Muted text (Saved, the folder) follows the bar, to stay readable on it. */
.sheets-header :deep(.text-ink-gray-5) {
  color: var(--sn-bar-muted);
}
</style>
