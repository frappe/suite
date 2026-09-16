<script setup lang="ts">
import { Badge, Button, TextInput, toast } from "frappe-ui";
import {
  computed,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  watch,
} from "vue";

import type { DocumentSession } from "@/apps/drive";
import NavigationPanel from "@/apps/slides/components/NavigationPanel.vue";
import PropertiesPanel from "@/apps/slides/components/PropertiesPanel.vue";
import SlideContainer from "@/apps/slides/components/SlideContainer.vue";
import Toolbar from "@/apps/slides/components/Toolbar.vue";
import { useCommandHistory } from "@/apps/slides/composables/useCommandHistory";
import { useShortcuts } from "@/apps/slides/composables/useShortcuts";
import { resetFocus } from "@/apps/slides/stores/element";
import {
  actionOrder as historyMetaActionOrder,
  actions as historyMetaActions,
  setCommandHistory,
} from "@/apps/slides/stores/historyMeta";
import {
  initPresentationDoc,
  inReadonlyMode,
  presentationDoc,
  resetEditorState,
  slidesLength,
} from "@/apps/slides/stores/presentation";
import {
  dirty,
  isSaving,
  saveChanges,
  saveCurrentState,
  saveFailed,
} from "@/apps/slides/stores/saving";
import {
  changeEditorSlide,
  focusedSlide,
  setSlideIndex,
  slides,
} from "@/apps/slides/stores/slide";
import { inSlideShowMode } from "@/apps/slides/stores/slideshow";
import {
  CompositeGroupLoader,
  mergeCompositeSlides,
  type CompositeItem,
  type CompositeManifest,
} from "./compositeGroups";
import { useDocumentLeaveGuard, type DocumentSaveState } from "./navigation";

const props = defineProps<{ session: DocumentSession }>();
const role = computed(() => props.session.access.value.role ?? 0);
const readable = computed(() => props.session.state.value !== "Refused" && role.value >= 10);
const editable = computed(
  () => readable.value && props.session.state.value === "Active" && role.value >= 40,
);
const titleDraft = ref(props.session.title.value);
const loading = ref(true);
const loadError = ref("");
const online = ref(typeof navigator === "undefined" ? true : navigator.onLine);
const compositeItems = ref<CompositeItem[]>([]);
const compositeLoader = ref<CompositeGroupLoader | null>(null);
const showPanel = ref<"comments" | "versions" | null>(null);
const panelRows = ref<unknown[]>([]);
const panelLoading = ref(false);
const isSlideInteractionActive = ref(false);
let autosaveTimer: number | undefined;

const history = useCommandHistory(slides, {
  actions: historyMetaActions,
  actionOrder: historyMetaActionOrder,
});
setCommandHistory(history);
useShortcuts(inReadonlyMode, inSlideShowMode);

provide("inReadonlyMode", inReadonlyMode);
provide("inSlideShowMode", inSlideShowMode);
provide("isOnline", online);

watch(() => props.session.title.value, (title) => { titleDraft.value = title; });
watch(editable, (canEdit, couldEdit) => {
  if (couldEdit && !canEdit) {
    void saveCurrentState();
    toast.warning("Editing access changed. Your local presentation copy was kept.");
  }
  inReadonlyMode.value = !canEdit;
}, { immediate: true });

async function rename() {
  const title = titleDraft.value.trim();
  if (!title || title === props.session.title.value || !editable.value) {
    titleDraft.value = props.session.title.value;
    return;
  }
  try {
    await props.session.rename(title);
    if (presentationDoc.value) presentationDoc.value.title = title;
  } catch (error) {
    titleDraft.value = props.session.title.value;
    toast.error(error instanceof Error ? error.message : "Could not rename the presentation.");
  }
}

async function share() {
  const result = await props.session.share();
  if (!result.available) toast.info(result.title, { description: result.reason });
}

async function openPanel(kind: "comments" | "versions") {
  showPanel.value = showPanel.value === kind ? null : kind;
  if (!showPanel.value) return;
  panelLoading.value = true;
  try {
    const result = kind === "comments"
      ? await props.session.comments.list()
      : await props.session.versions.list();
    panelRows.value = Array.isArray(result)
      ? result
      : ((result as any)?.rows ?? (result as any)?.data ?? []);
  } finally {
    panelLoading.value = false;
  }
}

async function loadComposite() {
  const ownCodes = await props.session.credentials.codesFor([props.session.nodeId]);
  const manifest = await frappeGet<CompositeManifest>(
    "suite.slides.api.composite.composite_manifest",
    { name: props.session.contentDocname },
    ownCodes,
  );
  const loader = new CompositeGroupLoader(
    manifest,
    props.session.credentials,
    async (references, codes) => frappeGet(
      "suite.slides.api.composite.composite_group",
      { name: props.session.contentDocname, references },
      [...new Set([...ownCodes, ...codes])],
    ),
    (items) => {
      compositeItems.value = items.map((item) => ({ ...item }));
      const merged = mergeCompositeSlides(items).map((entry) =>
        entry.slide ? normalizeCompositeSlide(entry.slide) : placeholderSlide(entry),
      );
      slides.value = merged;
      slidesLength.value = merged.length;
      if (merged.length) setSlideIndex(1);
    },
  );
  compositeLoader.value = loader;
  compositeItems.value = loader.items.map((item) => ({ ...item }));
  await loader.load();
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    const doc = await initPresentationDoc(props.session.contentDocname, !editable.value);
    if (presentationDoc.value) presentationDoc.value.title = props.session.title.value;
    setSlideIndex(1);
    if (doc?.is_composite) await loadComposite();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : "Could not open this presentation.";
  } finally {
    loading.value = false;
  }
}

function normalizeCompositeSlide(value: unknown) {
  const slide = { ...(value as Record<string, any>) };
  if (typeof slide.elements === "string") {
    try { slide.elements = JSON.parse(slide.elements); }
    catch { slide.elements = []; }
  }
  slide.elements ??= [];
  slide.clientId = slide.client_id || slide.clientId || slide.name;
  slide.transitionDuration = slide.transition_duration ?? slide.transitionDuration ?? 0;
  slide.fadeUnmatchedElements = slide.fade_unmatched_elements ?? slide.fadeUnmatchedElements ?? 0;
  return slide;
}

function placeholderSlide(entry: { reference: string; index: number; status: string }) {
  return {
    name: `composite-placeholder-${entry.reference}`,
    clientId: `composite-placeholder-${entry.reference}`,
    idx: entry.index,
    background: "#ffffffff",
    elements: [],
    transition: "None",
    transitionDuration: 0,
    fadeUnmatchedElements: 0,
    compositePlaceholder: entry.status,
  };
}

async function frappeGet<T>(method: string, args: Record<string, unknown>, codes: readonly string[]): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    query.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  }
  const response = await fetch(`/api/method/${method}?${query}`, {
    credentials: "same-origin",
    headers: codes.length ? { "X-Drive-Links": codes.join(",") } : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.exc) throw new Error(body.message ?? body.exc_type ?? "Request failed");
  return (body.message ?? body.data ?? body) as T;
}

const saveState = computed<DocumentSaveState>(() =>
  isSaving.value ? "saving" : saveFailed.value ? "failed" : dirty.value ? "unsaved" : "clean",
);
async function flush() { await saveChanges(); }
function retainRecovery() { void saveCurrentState(); }
useDocumentLeaveGuard({ state: () => saveState.value, flush, retainRecovery });

function setOnline() { online.value = true; }
function setOffline() { online.value = false; }
onMounted(() => {
  void load();
  autosaveTimer = window.setInterval(() => {
    if (editable.value && !isSlideInteractionActive.value && !focusedSlide.value) void saveChanges();
  }, 1_000);
  window.addEventListener("online", setOnline);
  window.addEventListener("offline", setOffline);
});
onBeforeUnmount(() => {
  if (autosaveTimer) window.clearInterval(autosaveTimer);
  window.removeEventListener("online", setOnline);
  window.removeEventListener("offline", setOffline);
  resetFocus();
  void saveCurrentState();
  resetEditorState();
});
</script>

<template>
  <div class="relative flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-surface-base">
    <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-outline-gray-1 px-3 sm:px-5">
      <span class="lucide-presentation size-5 text-ink-gray-6" aria-hidden="true" />
      <TextInput v-model="titleDraft" class="min-w-0 max-w-md flex-1" variant="ghost" :disabled="!editable" aria-label="Presentation title" @blur="rename" />
      <span class="text-sm text-ink-gray-5">{{ isSaving ? "Saving…" : saveFailed ? "Not saved" : dirty ? "Unsaved" : "Saved" }}</span>
      <Badge v-if="!online" label="Offline" theme="amber" variant="subtle" />
      <Badge v-if="!editable" :label="session.state.value === 'Trashed' ? 'Trashed' : 'View only'" theme="gray" variant="subtle" />
      <Button icon="lucide-message-square" tooltip="Comments" variant="ghost" @click="openPanel('comments')" />
      <Button icon="lucide-history" tooltip="Versions" variant="ghost" @click="openPanel('versions')" />
      <Button label="Share" icon-left="lucide-share-2" variant="solid" @click="share" />
    </header>

    <div v-if="loading" class="m-auto text-sm text-ink-gray-5">Opening presentation…</div>
    <div v-else-if="loadError || !readable" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <p class="mt-2 text-p-sm text-ink-gray-6">{{ loadError || "You no longer have permission to read this presentation." }}</p>
    </div>
    <div v-else class="relative flex min-h-0 flex-1 bg-surface-gray-1">
      <SlideContainer v-if="presentationDoc" v-model:has-ongoing-interaction="isSlideInteractionActive" />
      <NavigationPanel class="absolute inset-y-0 left-0" @change-slide="changeEditorSlide" />
      <Toolbar v-if="editable && presentationDoc" />
      <PropertiesPanel v-if="editable" class="absolute inset-y-0 right-0" />
    </div>

    <div v-if="compositeItems.length" class="absolute bottom-3 left-1/2 z-20 flex max-w-[70%] -translate-x-1/2 gap-1 rounded-6 border border-outline-gray-1 bg-surface-elevation-2 p-2 shadow-2xl">
      <button
        v-for="item in compositeItems"
        :key="item.reference"
        type="button"
        class="rounded-4 px-2 py-1 text-xs"
        :class="item.status === 'ready' ? 'bg-surface-green-2 text-ink-green-7' : item.status === 'loading' ? 'bg-surface-gray-2 text-ink-gray-6' : 'bg-surface-amber-2 text-ink-amber-7'"
        :disabled="item.status !== 'failed'"
        @click="item.group !== undefined && compositeLoader?.retry(item.group)"
      >
        {{ item.index }} · {{ item.status }}
      </button>
    </div>

    <aside v-if="showPanel" class="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-outline-gray-1 bg-surface-elevation-1 shadow-xl">
      <div class="flex min-h-12 items-center justify-between border-b px-4">
        <h2 class="text-lg-semibold">{{ showPanel === 'comments' ? 'Comments' : 'Versions' }}</h2>
        <Button icon="lucide-x" variant="ghost" @click="showPanel = null" />
      </div>
      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <p v-if="panelLoading" class="text-sm text-ink-gray-5">Loading…</p>
        <pre v-for="(row, index) in panelRows" v-else :key="index" class="whitespace-pre-wrap rounded-4 bg-surface-gray-1 p-3 text-p-xs">{{ row }}</pre>
        <p v-if="!panelLoading && !panelRows.length" class="text-sm text-ink-gray-5">Nothing here yet.</p>
      </div>
    </aside>
  </div>
</template>
