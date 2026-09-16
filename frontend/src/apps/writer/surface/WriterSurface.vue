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

import type { DocumentSession } from "@/apps/drive";
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
  () => readable.value && props.session.state.value === "Active" && role.value >= 40,
);
const saving = computed(
  () => !!documentResource.saveDoc?.loading || !!documentResource.saveHtml?.loading,
);
const saveFailed = computed(
  () => !!documentResource.saveDoc?.error || !!documentResource.saveHtml?.error,
);
const saveState = computed<DocumentSaveState>(() =>
  saving.value ? "saving" : saveFailed.value ? "failed" : dirty.value ? "unsaved" : "clean",
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
  if (editable.value && event.isTrusted) dirty.value = true;
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
  if (!dirty.value && !saving.value) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 10_000);
    emitter.emit("manual-save", () => {
      window.clearTimeout(timeout);
      if (!saveFailed.value) dirty.value = false;
      resolve();
    });
  });
}

useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery });

function setOnline() { online.value = true; }
function setOffline() { online.value = false; }
onMounted(() => {
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOffline);
});
onBeforeUnmount(() => {
  window.removeEventListener("online", setOnline);
  window.removeEventListener("offline", setOffline);
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
      <span class="text-sm text-ink-gray-5">
        {{ saving ? "Saving…" : saveFailed ? "Not saved" : dirty ? "Unsaved" : "Saved" }}
      </span>
      <Badge v-if="!online" label="Offline" theme="amber" variant="subtle" />
      <Badge v-if="!editable" :label="props.session.state.value === 'Trashed' ? 'Trashed' : 'View only'" theme="gray" variant="subtle" />
      <div v-if="collaborators.length" class="text-sm text-ink-gray-5">{{ collaborators.length }} present</div>
      <Button icon="lucide-message-square" tooltip="Comments" variant="ghost" @click="openPanel('comments')" />
      <Button icon="lucide-history" tooltip="Versions" variant="ghost" @click="openPanel('versions')" />
      <Button label="Share" icon-left="lucide-share-2" variant="solid" @click="share" />
    </header>

    <div v-if="!readable" class="m-auto text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">You no longer have permission to read this document.</p>
    </div>
    <div v-else-if="!documentResource.doc" class="mx-auto w-full max-w-[770px] space-y-3 px-5 pt-10">
      <Skeleton v-for="width in ['70%', '92%', '84%', '60%', '88%']" :key="width" class="h-3.5 rounded-4" :style="{ width }" />
    </div>
    <div v-else class="flex min-h-0 flex-1 overflow-hidden">
      <NonCollabEditor
        v-if="documentResource.doc.collab === 0"
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
