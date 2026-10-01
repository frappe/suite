<script setup lang="ts">
import { Badge, Button, Skeleton, TextInput, toast, useDoc } from "frappe-ui";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from "vue";

import { CollabOpenError, recoverable, type Blocked, type CollabRoom } from "@suite/collab-client";
import type { DocumentSession } from "@/apps/drive";
import { openWriterRoom } from "@/apps/writer/collab";
import CollabTextEditor from "@/apps/writer/components/CollabTextEditor.vue";
import NonCollabEditor from "@/apps/writer/components/NonCollabEditor.vue";
import TextEditor from "@/apps/writer/components/TextEditor.vue";
import emitter from "@/apps/writer/emitter";
import { freezesEdits } from "./access";
import { useDocumentLeaveGuard, type DocumentSaveState } from "./navigation";

const props = defineProps<{ session: DocumentSession }>();
const titleDraft = ref(props.session.title.value);
const editorSurface = shallowRef<any>(null);
const dirty = ref(false);
const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);
const showComments = ref(false);
const showVersions = ref(false);
const comments = ref<unknown[]>([]);
const versions = ref<unknown[]>([]);
const panelLoading = ref(false);
const commentText = ref("");
const collab = shallowRef<"opening" | "legacy" | "live" | "failed">("opening");
const room = shallowRef<CollabRoom | null>(null);
const roomSaveState = ref<DocumentSaveState>("clean");
const roomCanWrite = ref(false);
const roomBlocked = ref<Blocked | null>(null);
const roomPaused = ref<string | null>(null);
const roomUnsent = ref(0);
const openRefusal = ref<string | null>(null);
const recoveryKept = ref(false);
let stopWatchingRoom = () => {};
let unmounted = false;

const documentResource = useDoc({
  doctype: "Writer Document",
  name: props.session.contentDocname,
  transform(doc: any) {
    if (typeof doc.settings === "string") doc.settings = JSON.parse(doc.settings || "{}");
    else if (!doc.settings) doc.settings = {};
    return doc;
  },
  methods: {
    newVersion: "new_version",
    saveDoc: "save_doc",
    saveHtml: "save_html",
    updateSettings: "update_settings",
  },
}) as any;

const role = computed(() => props.session.access.value.role ?? 0);
const readable = computed(() => props.session.state.value !== "Refused" && role.value >= 10);
const editable = computed(
  () =>
    readable.value &&
    props.session.state.value === "Active" &&
    role.value >= 40 &&
    (collab.value !== "live" || (roomCanWrite.value && roomSaveState.value !== "failed")),
);
const saving = computed(
  () => !!documentResource.saveDoc?.loading || !!documentResource.saveHtml?.loading,
);
const saveFailed = computed(
  () => !!documentResource.saveDoc?.error || !!documentResource.saveHtml?.error,
);
const saveState = computed<DocumentSaveState>(() =>
  collab.value === "live"
    ? roomSaveState.value
    : saving.value ? "saving" : saveFailed.value ? "failed" : dirty.value ? "unsaved" : "clean",
);
const saveLabel = computed(() =>
  collab.value === "live" && roomPaused.value && saveState.value !== "failed"
    ? "Saving paused"
    : ({ saving: "Saving…", failed: "Not saved", unsaved: "Unsaved", clean: "Saved" })[saveState.value],
);
const blockedMessage = computed(() => {
  const kept = recoveryKept.value ? " Your unsent changes were kept as a recovery copy." : "";
  return {
    signed_out: "You're signed out. Sign in again to keep saving; your changes stay in this tab.",
    locked: "This document is locked again. Unlock it to keep saving; your changes stay in this tab.",
    stale_session: `You signed in again in another tab.${kept} Reload to keep saving.`,
    other_user: `This browser is now signed in as someone else.${kept} Reload to continue as them.`,
    lost_edit: `You can no longer edit this document.${kept}`,
    lost_read: `You can no longer open this document.${kept}`,
  }[roomBlocked.value!] ?? `Saving stopped in this tab.${kept} Reload to keep editing.`;
});
const openFailure = computed(() =>
  ({
    signed_out: "You're signed out. Sign in again to open this document.",
    locked: "This document is locked. Unlock it to open it.",
    stale_session: "You signed in again in another tab. Reload to open this document.",
    principal_changed: "This browser is now signed in as someone else. Reload to open this document as them.",
  })[openRefusal.value ?? ""] ?? "This document couldn't be opened.",
);
const settings = computed(() => documentResource.doc?.settings ?? {});
const fakeFileResource = computed(() => ({
  doc: {
    name: props.session.nodeId,
    file_name: props.session.title.value,
    write: editable.value,
    modified: new Date().toISOString(),
  },
}));
const collaborators = computed(() => editorSurface.value?.users ?? []);

provide("file", fakeFileResource);
provide("isOffline", computed(() => !online.value));

watch(() => props.session.title.value, (title) => { titleDraft.value = title; });
watch(role, (next, previous) => {
  if (!freezesEdits(previous, next)) return;
  retainRecovery();
  editorSurface.value?.editor?.commands?.setEditable?.(false);
  toast.warning("Editing access changed. Your local recovery copy was kept.");
});
watch(saving, (next, previous) => {
  if (previous && !next && !saveFailed.value) dirty.value = false;
});

function markDirty(event: Event) {
  if (editable.value && event.isTrusted && collab.value !== "live") dirty.value = true;
}

async function openCollab() {
  collab.value = "opening";
  openRefusal.value = null;
  try {
    const opened = await openWriterRoom(props.session);
    if (unmounted) {
      if (opened.state === "live") void opened.room.close();
      return;
    }
    if (opened.state !== "live") {
      collab.value = "legacy";
      return;
    }
    room.value = opened.room;
    const sync = () => {
      const live = opened.room;
      const stopped = live.saveState === "failed" || (live.blocked && !recoverable(live.blocked));
      if (stopped && live.unsent && !recoveryKept.value) {
        retainRecovery();
        recoveryKept.value = true;
      }
      roomSaveState.value = live.saveState;
      roomCanWrite.value = live.canWrite;
      roomBlocked.value = live.blocked;
      roomPaused.value = live.paused;
      roomUnsent.value = live.unsent;
    };
    stopWatchingRoom = opened.room.onChange(sync);
    sync();
    collab.value = "live";
  } catch (error) {
    openRefusal.value = error instanceof CollabOpenError ? error.reason : null;
    collab.value = "failed";
  }
}

async function rename() {
  const title = titleDraft.value.trim();
  if (!title || title === props.session.title.value || !editable.value) {
    titleDraft.value = props.session.title.value;
    return;
  }
  try {
    await props.session.rename(title);
  } catch (error) {
    titleDraft.value = props.session.title.value;
    toast.error(error instanceof Error ? error.message : "Could not rename the document.");
  }
}

async function share() {
  const result = await props.session.share();
  if (!result.available) toast.info(result.title, { description: result.reason });
}

async function openPanel(kind: "comments" | "versions") {
  showComments.value = kind === "comments" ? !showComments.value : false;
  showVersions.value = kind === "versions" ? !showVersions.value : false;
  if (!(showComments.value || showVersions.value)) return;
  panelLoading.value = true;
  try {
    const result = kind === "comments"
      ? await props.session.comments.list()
      : await props.session.versions.list();
    const rows = Array.isArray(result)
      ? result
      : ((result as any)?.rows ?? (result as any)?.data ?? []);
    if (kind === "comments") comments.value = rows;
    else versions.value = rows;
  } finally {
    panelLoading.value = false;
  }
}

async function addComment() {
  const text = commentText.value.trim();
  if (!text) return;
  await props.session.comments.create("document", text);
  commentText.value = "";
  await openPanel("comments");
  showComments.value = true;
}

function retainRecovery() {
  const html = editorSurface.value?.editor?.getHTML?.();
  if (!html) return;
  localStorage.setItem(
    `suite:writer-recovery:${props.session.nodeId}`,
    JSON.stringify({ savedAt: new Date().toISOString(), html }),
  );
}

function flush(): Promise<void> {
  if (room.value) return withinTenSeconds(room.value.flush());
  if (!dirty.value && !saving.value) return Promise.resolve();
  return withinTenSeconds(new Promise((resolve) => {
    emitter.emit("manual-save", () => {
      if (!saveFailed.value) dirty.value = false;
      resolve();
    });
  }));
}

function withinTenSeconds(work: Promise<void>): Promise<void> {
  return Promise.race([work, new Promise<void>((resolve) => window.setTimeout(resolve, 10_000))]);
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery });

function setOnline() { online.value = true; }
function setOffline() { online.value = false; }
onMounted(() => {
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOffline);
  void openCollab();
});
onBeforeUnmount(() => {
  unmounted = true;
  window.removeEventListener("online", setOnline);
  window.removeEventListener("offline", setOffline);
  stopWatchingRoom();
  void room.value?.close();
});
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base" @input.capture="markDirty" @keydown.capture="markDirty">
    <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-outline-gray-1 px-3 sm:px-5">
      <span class="lucide-file-text size-5 text-ink-gray-6" aria-hidden="true" />
      <TextInput
        v-model="titleDraft"
        class="min-w-0 max-w-md flex-1"
        variant="ghost"
        :disabled="!editable"
        aria-label="Document title"
        @blur="rename"
        @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
      />
      <span class="ml-auto text-sm text-ink-gray-5">
        {{ saveLabel }}<template v-if="collab === 'live' && roomUnsent"> · {{ roomUnsent }} unsent</template>
      </span>
      <Badge v-if="!online" label="Offline" theme="amber" variant="subtle" />
      <Badge v-if="!editable" :label="props.session.state.value === 'Trashed' ? 'Trashed' : 'View only'" theme="gray" variant="subtle" />
      <div v-if="collaborators.length" class="text-sm text-ink-gray-5">{{ collaborators.length }} present</div>
      <Button icon="lucide-message-square" tooltip="Comments" variant="ghost" @click="openPanel('comments')" />
      <Button icon="lucide-history" tooltip="Versions" variant="ghost" @click="openPanel('versions')" />
      <Button label="Share" icon-left="lucide-share-2" variant="solid" @click="share" />
    </header>

    <div v-if="collab === 'live' && (roomBlocked || roomSaveState === 'failed')" class="shrink-0 border-b border-outline-gray-1 bg-surface-amber-2 px-5 py-2 text-sm text-ink-amber-7" role="status">
      {{ blockedMessage }}
    </div>

    <div v-if="!readable" class="m-auto text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">You no longer have permission to read this document.</p>
    </div>
    <div v-else-if="collab === 'failed'" class="m-auto text-center">
      <p class="text-p-sm text-ink-gray-6">{{ openFailure }}</p>
      <Button class="mt-3" label="Try again" @click="openCollab" />
    </div>
    <div v-else-if="!documentResource.doc || collab === 'opening'" class="mx-auto w-full max-w-[770px] space-y-3 px-5 pt-10">
      <Skeleton v-for="width in ['70%', '92%', '84%', '60%', '88%']" :key="width" class="h-3.5 rounded-4" :style="{ width }" />
    </div>
    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
      <CollabTextEditor
        v-if="collab === 'live' && room"
        ref="editorSurface"
        :room="room"
        :file="fakeFileResource"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
      <NonCollabEditor
        v-else-if="documentResource.doc.collab === 0"
        ref="editorSurface"
        :file="fakeFileResource.doc"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
      <TextEditor
        v-else
        ref="editorSurface"
        :file="fakeFileResource"
        :document="documentResource"
        :settings="settings"
        :editable="editable"
      />
    </div>

    <aside v-if="showComments || showVersions" class="absolute inset-y-0 right-0 z-20 flex w-80 flex-col border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl">
      <div class="flex min-h-12 items-center justify-between border-b px-4">
        <h2 class="text-lg-semibold">{{ showComments ? "Comments" : "Versions" }}</h2>
        <Button icon="lucide-x" variant="ghost" @click="showComments = showVersions = false" />
      </div>
      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="panelLoading" class="text-sm text-ink-gray-5">Loading…</p>
        <template v-else-if="showComments">
          <div class="flex gap-2">
            <TextInput v-model="commentText" class="flex-1" placeholder="Add a comment" />
            <Button label="Add" :disabled="!commentText.trim()" @click="addComment" />
          </div>
          <pre v-for="(comment, index) in comments" :key="index" class="whitespace-pre-wrap rounded-4 bg-surface-gray-1 p-3 text-p-xs">{{ comment }}</pre>
          <p v-if="!comments.length" class="text-sm text-ink-gray-5">No comments yet.</p>
        </template>
        <template v-else>
          <pre v-for="(version, index) in versions" :key="index" class="whitespace-pre-wrap rounded-4 bg-surface-gray-1 p-3 text-p-xs">{{ version }}</pre>
          <p v-if="!versions.length" class="text-sm text-ink-gray-5">No versions yet.</p>
        </template>
      </div>
    </aside>
  </div>
</template>
