<script setup lang="ts">
import { Badge, Button, TextInput, Tooltip, toast } from "frappe-ui";
import { computed, ref, watch } from "vue";

import type { DocumentSession } from "@/apps/drive";
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

type Panel = "comments" | "versions" | null;

const props = defineProps<{ session: DocumentSession }>();

const editor = ref<SheetEditorHandle | null>(null);
const panel = ref<Panel>(null);
const titleDraft = ref(props.session.title.value);
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
const trashed = computed(() => props.session.state.value === "Trashed");
const cursor = computed<CellAnchor | null>(() =>
  editor.value ? { sheet: editor.value.currentSheet, cell: editor.value.activeCell } : null,
);

watch(() => props.session.title.value, (title) => { titleDraft.value = title; });

// A save that lands with edit access makes the recovery copy stale.
watch(() => editor.value?.saveState, (now, before) => {
  if (before !== "saving" || now !== "clean" || !access.writable.value || !hasRecovery.value) return;
  clearRecovery(props.session.nodeId);
  hasRecovery.value = false;
});

async function rename() {
  const title = titleDraft.value.trim();
  if (!title || title === props.session.title.value || !access.writable.value) {
    titleDraft.value = props.session.title.value;
    return;
  }
  try {
    await props.session.rename(title);
  } catch (error) {
    titleDraft.value = props.session.title.value;
    toast.error(error instanceof Error ? error.message : "Could not rename the spreadsheet.");
  }
}

function togglePanel(next: Exclude<Panel, null>) {
  panel.value = panel.value === next ? null : next;
  if (panel.value) editor.value?.closeNotes();
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
      <template #identity>
        <div class="flex min-w-0 items-center gap-2">
          <span class="lucide-table-2 size-4 shrink-0 text-ink-gray-6" aria-hidden="true" />
          <TextInput
            v-model="titleDraft"
            class="w-80 min-w-0"
            variant="ghost"
            :disabled="!access.writable.value"
            aria-label="Spreadsheet title"
            @blur="rename"
            @keydown.stop
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            @keydown.escape.prevent="titleDraft = session.title.value; ($event.target as HTMLInputElement).blur()"
          />
          <Badge v-if="trashed" label="Trashed" theme="gray" variant="subtle" size="sm" />
        </div>
      </template>

      <template #document-actions>
        <template v-if="hasRecovery">
          <span class="sheets-wide-only">
            <Button size="sm" variant="ghost" icon-left="lucide-download" label="Download my changes" @click="downloadChanges" />
          </span>
          <span class="sheets-compact-only">
            <Button
              size="sm"
              variant="ghost"
              icon="lucide-download"
              tooltip="Download my changes"
              aria-label="Download my changes"
              @click="downloadChanges"
            />
          </span>
        </template>
        <Button
          :variant="panel === 'comments' ? 'subtle' : 'ghost'"
          size="sm"
          icon="lucide-messages-square"
          tooltip="Comments"
          aria-label="Comments"
          :aria-pressed="panel === 'comments'"
          @click="togglePanel('comments')"
        />
        <Button
          :variant="panel === 'versions' ? 'subtle' : 'ghost'"
          size="sm"
          icon="lucide-history"
          tooltip="Versions"
          aria-label="Versions"
          :aria-pressed="panel === 'versions'"
          @click="togglePanel('versions')"
        />
        <!-- Stage 9 wires this to session.share. A disabled button fires no
             hover event, so the tooltip sits on a wrapper. -->
        <Tooltip text="Sharing arrives with the new share dialog">
          <span class="inline-flex" tabindex="0">
            <span class="sheets-wide-only">
              <Button size="sm" variant="ghost" icon-left="lucide-share-2" label="Share" disabled />
            </span>
            <span class="sheets-compact-only">
              <Button size="sm" variant="ghost" icon="lucide-share-2" aria-label="Share" disabled />
            </span>
          </span>
        </Tooltip>
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

/* The editor's top bar is the `sn-topbar` container. Below 640 px the
   surface's actions drop their labels, as the editor's own do. */
.sheets-wide-only {
  display: inline-flex;
}
.sheets-compact-only {
  display: none;
}
@container sn-topbar (max-width: 640px) {
  .sheets-wide-only {
    display: none;
  }
  .sheets-compact-only {
    display: inline-flex;
  }
}
</style>
