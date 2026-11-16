<script setup lang="ts">
import { dialog, toast } from 'frappe-ui'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'

import {
  DriveDocumentHeader,
  DriveDocumentMenu,
  driveNodeRoute,
  useDocumentComments,
  type DocumentPanel,
  type DocumentSession,
  type DocumentVersion,
} from '@/apps/drive'
import type { ChangedCell } from '@/apps/sheets/collab/changes'
import SheetEditor from '@/apps/sheets/components/SheetEditor/index.vue'
import { useHideRail } from '@/platform/rail'
import { useSession } from '@/platform/session'
import { translate as __ } from '@/platform/translation'

import { createSheetAccess } from './access'
import { cellCommentAnchors } from './commentPlaces'
import { useDocumentLeaveGuard, type DocumentSaveState } from './navigation'
import { cellAnchor, type CellAnchor } from './records'
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from './recovery'
import SheetSidePanel from './SheetSidePanel.vue'
import SheetVersionBar from './SheetVersionBar.vue'
import {
  copyFromVersion,
  errorText,
  fetchVersion,
  nextStep,
  readPreview,
  versionTitle,
  type VersionPreview,
} from './versions'

/** What the surface reads from the editor it mounts (`defineExpose`). */
interface SheetEditorHandle {
  readonly activeCell: string
  readonly currentSheet: string
  /** The workbook's sheets, in order. */
  readonly sheetNames: readonly string[]
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
  /** Saves the workbook it shows through the browser, as an Excel file. */
  exportXLSX(): Promise<void>
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
      toast.info(__('You can edit this spreadsheet again'))
      return
    }
    bodyRevision.value += 1
    toast.info(__('You can edit this spreadsheet again'))
  },
})
// A version shown read-only in place of the sheet (the live room closes meanwhile).
const preview = shallowRef<VersionPreview | null>(null)
const previewStep = ref<number | null>(null)
// The version last picked in the panel, which `preview` catches up with once it has loaded
const picked = shallowRef<DocumentVersion | null>(null)
// The live room's doc when the first preview opened: each version is compared with it.
let liveState: Uint8Array | null = null
// Counts each pick of a version or the way back, so a slower load can tell it was passed
let previewPick = 0
// The load of the picked version, for a Download that asks for it while it loads
let pickLoad: Promise<void> = Promise.resolve()
const sidePanel = useTemplateRef('sidePanel')
/**
 * The editor's aside, where the side panel sits. A shown version or a restore remounts the editor,
 * and the panel moves to the new aside with its list, name box and drafts.
 */
const panelDock = shallowRef<HTMLElement>()
let scrolled: { list: Element; top: number } | null = null
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

const comments = useDocumentComments(props.session, {
  isShown: () => props.session.panels.value.includes('comments'),
  isOpen: () => panel.value === 'comments',
  anchors: cellCommentAnchors,
})

/** Comments, Versions and Notes share the right edge: one closes the others. */
function showPanel(next: DocumentPanel | null) {
  panel.value = next
  if (next) editor.value?.closeNotes()
}

// Insert > Comment and the toolbar's Comment start a comment on the cursor cell
function commentOnCell() {
  if (access.canComment.value && cursor.value) {
    comments.drafts.start(cellAnchor(cursor.value))
  }

  showPanel('comments')
}

const openComments = computed(() =>
  props.session.panels.value.includes('comments') ? commentOnCell : undefined,
)
const sheetNames = computed(() => editor.value?.sheetNames ?? [])
function goToCell(sheet: string, cell: string) {
  return editor.value?.goToCell(sheet, cell) ?? false
}
function togglePanel(name: DocumentPanel) {
  showPanel(panel.value === name ? null : name)
}
// Comments are on the current cells, so opening them ends a preview; closing the panel keeps it
watch(panel, (now) => {
  if (now === 'comments') void leavePreview()
})
// An editor going away hands back null, which leaves the panel where it is until the next aside
function keepPanelDock(aside: unknown) {
  if (aside instanceof HTMLElement) panelDock.value = aside
}
function rememberScroll(event: Event) {
  if (event.target instanceof Element)
    scrolled = { list: event.target, top: event.target.scrollTop }
}
// A list moved to the new aside comes back scrolled to the top
watch(
  panelDock,
  () => {
    if (scrolled) scrolled.list.scrollTop = scrolled.top
  },
  { flush: 'post' },
)
// A preview's editor washes the cells its version changed once it has loaded.
watch(editor, async (current) => {
  const shown = preview.value
  if (!current || !shown) return
  await current.whenLoaded()
  if (editor.value === current) current.showChanges(shown.changes)
})

function previewVersion(version: DocumentVersion | null) {
  if (!version) return leavePreview()
  const isPicked = picked.value?.seq === version.seq
  picked.value = version
  if (preview.value?.version.seq === version.seq) preview.value = { ...preview.value, version }
  // The panel holds the pick, so the same version back from it is a new name and no new pick
  if (!isPicked) pickLoad = loadPick(version, ++previewPick)
  return pickLoad
}
async function loadPick(version: DocumentVersion, pick: number) {
  // A pick of the version already shown only drops a slower load of another one
  if (preview.value?.version.seq === version.seq) return
  try {
    if (!preview.value) {
      // The sheet closes while a version is shown: its edits are saved first.
      await flushEdits()
      liveState = editor.value?.docState() ?? null
    }
    const bytes = await fetchVersion(props.session, version.seq)
    const read = await readPreview(version, bytes, liveState)
    // Another version or the way back was picked while this one loaded
    if (pick !== previewPick) return
    // It may have been renamed while it loaded
    preview.value = { ...read, version: picked.value ?? version }
    previewStep.value = null
  } catch (error) {
    if (pick !== previewPick) return
    picked.value = preview.value?.version ?? null
    toast.error(errorText(error, __('This version could not be shown')))
  }
}
/** Back to the sheet as it is now; resolves once its editor has loaded. */
async function leavePreview() {
  previewPick += 1
  picked.value = null
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
function confirmRestore(version: DocumentVersion) {
  dialog.confirm({
    title: __('Restore this version?'),
    message: __(
      'The spreadsheet goes back to this version. Its current state is kept as a new version first.',
    ),
    confirmLabel: __('Restore'),
    onConfirm: async () => {
      await restoreVersion(String(version.seq))
      toast.success(__('Version restored'))
      await sidePanel.value?.reloadVersions()
    },
  })
}
// The list's Download: the version is shown, then saved as the editor's Excel export
async function downloadVersion(version: DocumentVersion) {
  await previewVersion(version)
  await nextTick()
  const shown = editor.value
  const isStillShown = () => editor.value === shown && preview.value?.version.seq === version.seq
  if (!shown || !isStillShown()) return
  try {
    await shown.whenLoaded()
    // Another version or the way back was picked while this one loaded
    if (!isStillShown()) return
    await shown.exportXLSX()
  } catch {
    toast.error(__('Could not download this version'))
  }
}
function makeCopy(version: DocumentVersion) {
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
    toast.error(__('Could not keep your latest changes on this device'))
    return false
  } finally {
    copying.value = false
  }
}
async function downloadChanges() {
  try {
    const downloaded = await downloadRecovery(props.session.nodeId, props.session.title.value)
    hasRecovery.value = false
    if (!downloaded) toast.error(__('No recovery copy is kept for this spreadsheet'))
  } catch {
    toast.error(__('Could not download your changes. They are still kept on this device.'))
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
    <template v-else>
      <SheetEditor
        :id="session.contentDocname"
        :key="editorKey"
        ref="editor"
        :writable="editorWritable"
        :title="session.title.value"
        :request-context="session.credentials.context"
        :collab-session="preview ? undefined : session"
        :version="preview?.bytes"
        :open-comments="openComments"
        @reopen="bodyRevision += 1"
        @notes-opened="panel = null"
      >
        <template
          #header="{
            viewOnly,
            status: EditorStatus,
            menus: EditorMenus,
            actions: EditorActions,
            menuItems,
          }"
        >
          <DriveDocumentHeader
            class="sheets-header"
            :session="session"
            title-label="Spreadsheet title"
            :save-state="editor?.saveState ?? null"
            :view-only="viewOnly"
            :recoverable="hasRecovery"
            @download-changes="downloadChanges"
          >
            <template #status>
              <component :is="EditorStatus" />
            </template>
            <template #actions>
              <component :is="EditorActions" />
            </template>
            <template #menu>
              <DriveDocumentMenu
                :session="session"
                :panels="session.panels.value"
                :panel="panel"
                :transfer="menuItems.transfer"
                :settings="menuItems.settings"
                @toggle-panel="togglePanel"
              />
            </template>
          </DriveDocumentHeader>
          <div class="sheets-menus">
            <component :is="EditorMenus" />
          </div>
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
            @copy="makeCopy(preview.version)"
            @restore="confirmRestore(preview.version)"
          />
        </template>

        <template #aside>
          <div :ref="keepPanelDock" class="contents" />
        </template>
      </SheetEditor>
      <Teleport v-if="panelDock" :to="panelDock">
        <SheetSidePanel
          ref="sidePanel"
          v-model:panel="panel"
          :session="session"
          :comments="comments"
          :sheets="sheetNames"
          :can-comment="access.canComment.value"
          :can-edit-document="access.writable.value"
          :go-to-cell="goToCell"
          :previewed-version="picked"
          :is-restoring-version="restoring"
          :save-first="flushEdits"
          @update:previewed-version="previewVersion"
          @restore-version="confirmRestore"
          @download-version="downloadVersion"
          @back="leavePreview"
          @scroll.capture.passive="rememberScroll"
        />
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
:deep(.sn-root) {
  height: 100%;
  min-height: 0;
}

/* The editor's status chips and menu bar answer to the `sn-topbar` container:
   below 640 px the five menus fold into one. */
.sheets-header,
.sheets-menus {
  container: sn-topbar / inline-size;
  /* The bars' colours live on the editor root (SheetEditor.css --sn-bar-*). */
  background: var(--sn-bar-bg);
}
.sheets-header {
  border-bottom-color: var(--sn-bar-line);
  position: relative;
  z-index: 10;
}
/* The menus' own row, between the header and the tools, with the header's
   line under it. Its side gutter and the 4px above and below the words are
   the tools row's. */
.sheets-menus {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  padding: 4px 12px;
  border-bottom: 1px solid var(--sn-bar-line);
}
/* Hover and "on" fills follow the bar colours, as in the tools row; solid
   buttons keep their own. Only a panel toggle (`data-panel`) shows the "on" fill. */
.sheets-header :deep(button:not(:disabled, .bg-surface-gray-10):hover),
.sheets-menus :deep(button:not(:disabled):hover) {
  background: var(--sn-bar-hover);
}
.sheets-header :deep(button[data-state='open']),
.sheets-menus :deep(button[data-state='open']),
.sheets-header :deep(button[data-panel][aria-pressed='true']) {
  background: var(--sn-bar-on);
}
.sheets-header :deep(button[data-panel][aria-pressed='true']) {
  box-shadow: inset 0 0 0 1px var(--sn-bar-on-edge);
}
/* Muted text (Saved, the folder) follows the bar, to stay readable on it. */
.sheets-header :deep(.text-ink-gray-5) {
  color: var(--sn-bar-muted);
}
</style>
