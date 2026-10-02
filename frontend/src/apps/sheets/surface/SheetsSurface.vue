<script setup lang="ts">
import { Button, toast } from "frappe-ui";
import { computed, ref, watch } from "vue";

import { DriveDocumentHeader, type DocumentPanel, type DocumentSession } from "@/apps/drive";
import SheetEditor from "@/apps/sheets/components/SheetEditor/index.vue";
import { createSheetAccess } from "./access";
import { useDocumentLeaveGuard, type DocumentSaveState } from "./navigation";
import type { CellAnchor } from "./records";
import { clearRecovery, downloadRecovery, keepRecovery, readRecovery } from "./recovery";
import SheetCommentsPanel from "./SheetCommentsPanel.vue";
import SheetVersionsPanel from "./SheetVersionsPanel.vue";

/** What the surface reads from the editor it mounts (`defineExpose`). */
interface SheetEditorHandle {
  readonly activeCell: string;
  readonly currentSheet: string;
  readonly saveState: DocumentSaveState;
  flushSave(): Promise<void>;
  /** The workbook, with the cell edit still in progress. */
  workbookJson(): string;
  /** True while the formula bar or the cell editor holds uncommitted text. */
  hasDraft(): boolean;
  goToCell(sheet: string, cell: string): boolean;
  closeNotes(): void;
}

const props = defineProps<{ session: DocumentSession }>();

const editor = ref<SheetEditorHandle | null>(null);
const panel = ref<DocumentPanel | null>(null);
// A restore, or edit access coming back, reloads the server workbook: the
// editor remounts under a new key.
const bodyRevision = ref(0);
const restoring = ref(false);
const hasRecovery = ref(readRecovery(props.session.nodeId) !== null);

const access = createSheetAccess(props.session, {
  narrowed() {
    const current = editor.value;
    const unsaved = current !== null && (current.saveState !== "clean" || current.hasDraft());
    if (!unsaved) {
      toast.warning("Editing access changed. This spreadsheet is now view only.");
      return;
    }
    retainRecovery();
    toast.warning("Editing access changed. Your unsaved changes are kept on this device.", {
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Download my changes", onClick: downloadChanges },
    });
  },
  widened() {
    bodyRevision.value += 1;
    toast.info("You can edit this spreadsheet again.");
  },
});
const editorWritable = computed(() => access.writable.value && !restoring.value);
const cursor = computed<CellAnchor | null>(() =>
  editor.value ? { sheet: editor.value.currentSheet, cell: editor.value.activeCell } : null,
);

// A save that lands with edit access makes the recovery copy stale.
watch(() => editor.value?.saveState, (now, before) => {
  if (before !== "saving" || now !== "clean" || !access.writable.value || !hasRecovery.value) return;
  clearRecovery(props.session.nodeId);
  hasRecovery.value = false;
});

/** Comments, Versions and Notes share the right edge: one closes the others. */
function showPanel(next: DocumentPanel | null) {
  panel.value = next;
  if (next) editor.value?.closeNotes();
}

function selectAnchor(anchor: CellAnchor) {
  if (!editor.value?.goToCell(anchor.sheet, anchor.cell)) {
    toast.info(`${anchor.sheet} · ${anchor.cell} is no longer in this spreadsheet.`);
  }
}

/** Save pending edits, or refuse: a version holds only the saved state. */
async function flushEdits() {
  await editor.value?.flushSave();
  if (editor.value && editor.value.saveState !== "clean") {
    throw new Error("Your latest changes are not saved yet. Try again when the spreadsheet is saved.");
  }
}

async function restoreVersion(seq: string) {
  await flushEdits();
  restoring.value = true;
  try {
    await props.session.versions.restore(seq);
    bodyRevision.value += 1;
  } finally {
    restoring.value = false;
  }
}

function retainRecovery() {
  const workbook = editor.value?.workbookJson();
  if (!workbook) return;
  try {
    keepRecovery(props.session.nodeId, workbook);
    hasRecovery.value = true;
  } catch {
    toast.error("Your latest changes could not be kept on this device.");
  }
}

async function downloadChanges() {
  try {
    const downloaded = await downloadRecovery(props.session.nodeId, props.session.title.value);
    hasRecovery.value = false;
    if (!downloaded) toast.error("No recovery copy is kept for this spreadsheet.");
  } catch {
    toast.error("Your changes could not be downloaded. They are still kept on this device.");
  }
}

useDocumentLeaveGuard({
  state: () => editor.value?.saveState ?? "clean",
  flush: async () => { await editor.value?.flushSave(); },
  retainRecovery,
});
</script>

<template>
  <div class="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface-base">
    <div v-if="!access.readable.value" class="flex h-full flex-col items-center justify-center px-6 text-center">
      <span class="lucide-lock-keyhole size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">You no longer have permission to read this spreadsheet.</p>
    </div>
    <SheetEditor
      v-else
      :key="bodyRevision"
      ref="editor"
      :id="session.contentDocname"
      embedded
      :writable="editorWritable"
      :title="session.title.value"
      :credential-fetch="session.credentials.fetch"
      @access-refused="access.refuse()"
      @notes-opened="panel = null"
    >
      <template #header="{ viewOnly, status: EditorStatus, actions: EditorActions }">
        <DriveDocumentHeader
          class="sheets-header"
          :session="session"
          title-label="Spreadsheet title"
          :save-state="editor?.saveState ?? null"
          :view-only="viewOnly"
          :recoverable="hasRecovery"
          :panels="['comments', 'versions']"
          :panel="panel"
          @update:panel="showPanel"
          @download-changes="downloadChanges"
        >
          <template #status>
            <component :is="EditorStatus" />
          </template>
          <template #actions>
            <component :is="EditorActions" />
          </template>
        </DriveDocumentHeader>
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
          :writable="access.writable.value"
          :flush="flushEdits"
          :restore="restoreVersion"
          @close="panel = null"
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

/* The editor's top-bar actions answer to the `sn-topbar` container: below
   640 px they fold into one menu. */
.sheets-header {
  container: sn-topbar / inline-size;
  position: relative;
  z-index: 10;
}
</style>
