<script setup lang="ts">
import { Button } from "frappe-ui";
import { computed } from "vue";

import type { DocumentSession } from "@/apps/drive/client/session";
import type { FilePreviewSession } from "./session";

const props = defineProps<{ session: DocumentSession }>();
const file = computed(() => props.session as FilePreviewSession);
const mime = computed(() => file.value.mime ?? "");
const previewUrl = computed(() => file.value.preview.value?.url ?? "");
const contentUrl = computed(
  () => `/api/suite/drive/nodes/${encodeURIComponent(props.session.nodeId)}/content`,
);
const canPreview = computed(
  () =>
    !!previewUrl.value ||
    mime.value.startsWith("image/") ||
    mime.value.startsWith("audio/") ||
    mime.value.startsWith("video/") ||
    mime.value === "application/pdf" ||
    mime.value.startsWith("text/"),
);
const source = computed(() => previewUrl.value || contentUrl.value);
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base">
    <header class="flex min-h-12 shrink-0 items-center gap-3 border-b border-outline-gray-1 px-3 sm:px-5">
      <span class="lucide-file size-5 text-ink-gray-6" aria-hidden="true" />
      <h1 class="min-w-0 flex-1 truncate text-lg-semibold">{{ session.title.value }}</h1>
      <Button label="Download" icon-left="lucide-download" :link="contentUrl" />
    </header>
    <div v-if="!canPreview" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-file-question mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <h2 class="mt-3 text-lg-semibold">No preview</h2>
      <p class="mt-1 text-p-sm text-ink-gray-6">Download this file to open it.</p>
      <Button class="mt-4" label="Download" icon-left="lucide-download" :link="contentUrl" />
    </div>
    <img v-else-if="mime.startsWith('image/')" :src="source" :alt="session.title.value" class="m-auto max-h-full max-w-full object-contain p-4" />
    <audio v-else-if="mime.startsWith('audio/')" :src="contentUrl" controls class="m-auto w-full max-w-xl" />
    <video v-else-if="mime.startsWith('video/')" :src="contentUrl" controls class="m-auto max-h-full max-w-full" />
    <iframe v-else :src="contentUrl" :title="session.title.value" class="min-h-0 flex-1 border-0 bg-surface-base" />
  </div>
</template>
