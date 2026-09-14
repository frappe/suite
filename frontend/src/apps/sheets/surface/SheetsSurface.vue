<script setup lang="ts">
import { Badge, Button, toast } from "frappe-ui";
import { computed, ref, watch } from "vue";

import type { DocumentSession } from "@/apps/drive";
import SheetEditor from "@/apps/sheets/components/SheetEditor/index.vue";
import { useDocumentLeaveGuard, type DocumentSaveState } from "./navigation";

const props = defineProps<{ session: DocumentSession }>();
const dirty = ref(false);
const flushing = ref(false);
const downgraded = ref(false);

const role = computed(() => props.session.access.value.role ?? 0);
const readable = computed(() => props.session.state.value !== "Refused" && role.value >= 10);
const editable = computed(
  () => readable.value && props.session.state.value === "Active" && role.value >= 40,
);
const saveState = computed<DocumentSaveState>(() =>
  flushing.value ? "saving" : dirty.value ? "unsaved" : "clean",
);

watch(role, (next, previous) => {
  if (previous < 40 || next >= 40) return;
  retainRecovery();
  downgraded.value = true;
  toast.warning("Editing access changed. The spreadsheet is frozen and a recovery marker was kept.");
});

function noteEdit(event: Event) {
  if (!editable.value || !event.isTrusted) return;
  const target = event.target as HTMLElement;
  if (target.closest("button") || target.closest("[role='menu']")) return;
  dirty.value = true;
}

async function captureTitle(event: FocusEvent) {
  const target = event.target as HTMLInputElement;
  if (target?.name !== "sheet-title" || !editable.value) return;
  const title = target.value.trim();
  if (!title || title === props.session.title.value) return;
  try {
    await props.session.rename(title);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not rename the spreadsheet.");
  }
}

function captureActions(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest("button");
  if (!button || !/share/i.test(button.textContent ?? "")) return;
  event.preventDefault();
  event.stopPropagation();
  void props.session.share().then((result) => {
    if (!result.available) toast.info(result.title, { description: result.reason });
  });
}

function retainRecovery() {
  localStorage.setItem(
    `suite:sheets-recovery:${props.session.nodeId}`,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      contentDocname: props.session.contentDocname,
      reason: downgraded.value ? "access-downgrade" : "navigation",
    }),
  );
}

async function flush() {
  if (!dirty.value) return;
  flushing.value = true;
  await new Promise((resolve) => window.setTimeout(resolve, 2_100));
  flushing.value = false;
  dirty.value = false;
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery });
</script>

<template>
  <div
    class="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface-base"
    @keydown.capture="noteEdit"
    @paste.capture="noteEdit"
    @cut.capture="noteEdit"
    @focusout.capture="captureTitle"
    @click.capture="captureActions"
  >
    <div v-if="!readable" class="flex h-full flex-col items-center justify-center px-6 text-center">
      <span class="lucide-lock-keyhole size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">You no longer have permission to read this spreadsheet.</p>
    </div>
    <template v-else>
      <div v-if="!editable" class="absolute left-1/2 top-2 z-30 -translate-x-1/2">
        <Badge
          :label="props.session.state.value === 'Trashed' ? 'Trashed · View only' : 'View only'"
          theme="gray"
          variant="subtle"
        />
      </div>
      <div v-if="downgraded" class="absolute inset-x-0 top-12 z-30 flex items-center justify-center gap-2 bg-surface-amber-2 p-2 text-sm text-ink-amber-7">
        Editing access changed. Your current view is frozen.
        <Button label="Dismiss" size="xs" variant="ghost" @click="downgraded = false" />
      </div>
      <div class="h-full min-h-0" :inert="!editable || undefined">
        <SheetEditor :id="session.contentDocname" />
      </div>
    </template>
  </div>
</template>

<style scoped>
:deep(.sn-root) {
  height: 100%;
  min-height: 0;
}
</style>
