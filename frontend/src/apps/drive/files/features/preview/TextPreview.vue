<script setup lang="ts">
import { refDebounced, useEventListener } from "@vueuse/core";
import { Spinner } from "frappe-ui";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { CodeView } from "./codeView";
import PreviewFallback from "./PreviewFallback.vue";
import type { TextLanguage } from "../../internal/previewKind";
import { loadTextContent, TEXT_PREVIEW_LIMIT, type TextContent } from "./textContent";

const props = defineProps<{
  /** Where the file's bytes are. Also the download link. */
  src: string;
  size: number;
  language: TextLanguage;
  title: string;
  /** Shows a Markdown file rendered, not as its source. */
  rendered?: boolean;
}>();

const content = ref<TextContent | null>(null);
/** The indicator shows only when loading takes a while, so a quick load does not flash it. */
const slow = refDebounced(computed(() => content.value === null), 300);
/** The rendered Markdown, cleaned. Set only while `rendered`. */
const html = ref<string | null>(null);
const host = ref<HTMLElement | null>(null);
let view: CodeView | null = null;
let controller: AbortController | null = null;
/** Counts each `show`, so a slower earlier one never replaces what a later one shows. */
let showing = 0;

const LIMIT_MB = TEXT_PREVIEW_LIMIT / 1024 / 1024;

async function load() {
  controller?.abort();
  const own = (controller = new AbortController());
  content.value = null;
  let loaded: TextContent;
  try {
    loaded = await loadTextContent(props.src, props.size, own.signal);
  } catch {
    return;
  }
  if (!own.signal.aborted) content.value = loaded;
}

/** Shows the loaded text as source in the editor, or as rendered Markdown. */
async function show() {
  const own = ++showing;
  view?.destroy();
  view = null;
  html.value = null;
  const loaded = content.value;
  if (loaded?.status !== "ready") return;
  // The renderer and the editor load only when a file needs them.
  if (props.rendered) {
    const { renderMarkdown } = await import("./markdown");
    if (own === showing) html.value = renderMarkdown(loaded.text);
    return;
  }
  const { mountCodeView } = await import("./codeView");
  // Wait for the host element, which renders once the content is ready.
  await nextTick();
  if (own !== showing || !host.value) return;
  const mounted = await mountCodeView(host.value, { text: loaded.text, language: props.language, label: props.title });
  if (own !== showing) mounted.destroy();
  else view = mounted;
}

watch(() => [props.src, props.size] as const, load, { immediate: true });
watch(() => [content.value, props.language, props.rendered] as const, show);

onBeforeUnmount(() => {
  controller?.abort();
  showing += 1;
  view?.destroy();
});

// The browser's find sees only the lines on screen, so Cmd+F opens the
// editor's own find bar, which searches the whole file. It leaves the key
// alone when something else, such as the title field, has focus.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (!view || view.hasFocus() || event.defaultPrevented) return;
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "f") return;
  if (document.activeElement && document.activeElement !== document.body) return;
  event.preventDefault();
  view.find();
});
</script>

<template>
  <div v-if="content?.status === 'ready' && rendered" class="min-h-0 flex-1 overflow-auto">
    <!--
      `renderMarkdown` cleans the HTML: no script, event handler or raw HTML from the file.
      `prose-v3` gives paragraphs no margin, because the editor spaces them with
      empty paragraphs. Markdown has none, so paragraphs in a row get a gap.
    -->
    <article
      v-if="html !== null"
      class="prose prose-v3 mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-10 [&_p+p]:mt-[0.75em]"
      v-html="html"
    />
  </div>
  <div v-else-if="content?.status === 'ready'" ref="host" class="min-h-0 flex-1 overflow-hidden" />
  <Spinner v-else-if="content === null && slow" size="lg" theme="gray" class="m-auto" />
  <PreviewFallback
    v-else-if="content?.status === 'too-large'"
    title="Too large to preview"
    :message="`This file is over ${LIMIT_MB} MB. Download it to open it.`"
    :download="src"
  />
  <PreviewFallback
    v-else-if="content?.status === 'unreadable'"
    title="No preview"
    message="This file is not plain text. Download it to open it."
    :download="src"
  />
  <PreviewFallback
    v-else-if="content?.status === 'failed'"
    title="Could not load the preview"
    message="Download this file to open it."
    :download="src"
  />
</template>
