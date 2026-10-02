<script setup lang="ts">
import { Badge, Button, dialog, Skeleton, toast } from "frappe-ui";
import { onMounted, ref } from "vue";

import type { DocumentSession } from "@/apps/drive";
import { readVersions, stampLabel, type SlidesVersion } from "./versions";

const props = defineProps<{
  session: DocumentSession;
  writable: boolean;
  /** Saves pending edits. Rejects while any edit is still unsaved. */
  flush: () => Promise<void>;
  /** Saves pending edits, pauses editing, restores the version and reloads the presentation. */
  restore: (seq: string) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();

const versions = ref<SlidesVersion[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const loadError = ref("");

const KIND_LABELS: Record<string, string> = {
  auto: "Automatic version",
  named: "Named version",
  milestone: "Milestone",
};

async function load(cursor?: string) {
  try {
    const page = readVersions(await props.session.versions.list(cursor));
    versions.value = cursor ? [...versions.value, ...page.rows] : page.rows;
    nextCursor.value = page.nextCursor;
    if (!cursor) loadError.value = "";
  } catch (error) {
    // A failed next page keeps the rows already shown.
    if (cursor) toast.error(message(error, "Could not load more versions."));
    else loadError.value = message(error, "Check your connection, then try again.");
  } finally {
    loading.value = false;
  }
}

async function retry() {
  loading.value = true;
  await load();
}

async function loadMore() {
  if (!nextCursor.value) return;
  loadingMore.value = true;
  await load(nextCursor.value);
  loadingMore.value = false;
}

function saveVersion() {
  dialog.prompt({
    title: "Save a version",
    fields: [{ name: "label", label: "Name", required: true, placeholder: "Before the review" }],
    confirmLabel: "Save",
    onConfirm: async ({ values }) => {
      // A version is the saved state: the edits still pending go in first.
      await props.flush();
      await props.session.versions.create("named", String(values.label ?? "").trim());
      toast.success("Version saved");
      await load();
    },
  });
}

function confirmRestore(version: SlidesVersion) {
  dialog.confirm({
    title: "Restore this version?",
    message: "The presentation goes back to this version. Its current state is kept as a new version first.",
    confirmLabel: "Restore",
    onConfirm: async () => {
      await props.restore(version.seq);
      toast.success("Version restored");
      await load();
    },
  });
}

function versionLabel(version: SlidesVersion): string {
  return version.label || KIND_LABELS[version.kind] || "Version";
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

onMounted(() => load());
</script>

<template>
  <aside
    class="absolute bottom-0 right-0 top-12 z-30 flex w-full flex-col md:w-80 border-l border-outline-gray-2 bg-surface-base text-ink-gray-8 shadow-xl"
    aria-label="Versions"
    @click.stop
    @keydown.stop
  >
    <header class="flex min-h-12 shrink-0 items-center justify-between border-b border-outline-gray-1 pl-4 pr-2">
      <h2 class="text-lg-semibold">Versions</h2>
      <div class="flex items-center gap-1">
        <Button v-if="writable" size="sm" label="Save version" icon-left="lucide-bookmark-plus" @click="saveVersion" />
        <Button icon="lucide-x" variant="ghost" aria-label="Close versions" @click="emit('close')" />
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto pb-10">
      <div v-if="loading" class="space-y-3 p-4" aria-hidden="true">
        <Skeleton v-for="row in 4" :key="row" class="h-12 w-full rounded-4" />
      </div>
      <div v-else-if="loadError" class="px-4 py-10 text-center" role="alert">
        <p class="text-p-sm text-ink-gray-7">Versions could not be loaded.</p>
        <p class="mt-1.5 text-p-sm text-ink-gray-5">{{ loadError }}</p>
        <Button class="mt-4" label="Retry" icon-left="lucide-refresh-cw" @click="retry" />
      </div>
      <div v-else-if="!versions.length" class="px-4 py-10 text-center">
        <p class="text-p-sm text-ink-gray-7">No versions yet.</p>
        <p class="mt-1.5 text-p-sm text-ink-gray-5">Save a version to keep this state of the presentation.</p>
      </div>
      <ul v-else class="divide-y divide-outline-gray-1">
        <li v-for="version in versions" :key="version.seq" class="flex items-center gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-base text-ink-gray-8">{{ versionLabel(version) }}</span>
              <Badge v-if="version.pinned" label="Pinned" theme="gray" variant="subtle" size="sm" />
            </div>
            <p class="mt-1.5 truncate text-sm text-ink-gray-5">
              {{ [stampLabel(version.creation), version.actor].filter(Boolean).join(" · ") }}
            </p>
          </div>
          <Button
            v-if="writable"
            size="sm"
            variant="ghost"
            label="Restore"
            @click="confirmRestore(version)"
          />
        </li>
      </ul>
      <div v-if="nextCursor" class="p-4">
        <Button class="w-full" label="Load more" :loading="loadingMore" @click="loadMore" />
      </div>
    </div>
  </aside>
</template>
