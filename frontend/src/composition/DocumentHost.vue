<script lang="ts">
import type { Component } from "vue";

import type { DocumentSession } from "@/apps/drive";
import { filePreviewSurface } from "@/apps/drive";
import type { DocumentTypeDefinition } from "@/platform/contracts";

export const FILE_CONTENT_DOCTYPE = "File";

export async function selectDocumentSurface(
  session: DocumentSession,
  definitions: readonly DocumentTypeDefinition[],
): Promise<Component | null> {
  if (session.contentDoctype === FILE_CONTENT_DOCTYPE) return filePreviewSurface;
  const definition = definitions.find(
    (candidate) => candidate.contentDoctype === session.contentDoctype,
  );
  return definition ? definition.loadSurface() : null;
}
</script>

<script setup lang="ts">
import { Button } from "frappe-ui";
import {
  computed,
  inject,
  onBeforeUnmount,
  shallowRef,
  watch,
} from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";

import {
  DriveDocumentHeaderSkeleton,
  DriveUnlockScreen,
  driveNodeRoute,
  isDriveLocked,
  isDriveNodeLocked,
  openDocumentSession,
} from "@/apps/drive";
import { documentTypes } from "@/composition/documentRegistry";
import { openingTitle as historyOpeningTitle, usePageTitle } from "@/platform/page-meta";
import { TransportError } from "@/platform/transport";
import { GUEST_FRAME_KEY } from "@/platform/contracts";

const route = useRoute();
const router = useRouter();
const session = shallowRef<DocumentSession | null>(null);
const surface = shallowRef<Component | null>(null);
const loading = shallowRef(true);
const error = shallowRef("");
// A password link answered `401 DriveLocked`: the unlock screen shows in place (spec §10.2).
const locked = shallowRef(false);
// Present only in the guest frame, where a refused node shows the Sign-in screen (spec §10.8).
const guestFrame = inject(GUEST_FRAME_KEY, null);
const reopen = shallowRef(0);
let opening = 0;

const nodeId = computed(() => String(route.params.node ?? ""));
// Until the session answers, the tab keeps the route's title: the name the
// opener put on this history entry, otherwise "Opening…". The skeleton header
// shows the same name. The entry is current once the route is.
const openingTitle = computed(() => (nodeId.value ? historyOpeningTitle(router.options.history.state) : null));
usePageTitle(() => session.value?.title.value ?? "");
const downloadUrl = computed(
  () => `/api/suite/drive/nodes/${encodeURIComponent(nodeId.value)}/content`,
);
const refused = computed(
  () =>
    session.value?.state.value === "Refused" ||
    (session.value?.access.value.role ?? 0) < 10,
);

watch(
  [nodeId, reopen],
  async ([node]) => {
    const request = ++opening;
    const previous = session.value;
    session.value = null;
    surface.value = null;
    error.value = "";
    locked.value = false;
    loading.value = true;
    previous?.dispose();

    if (!node) {
      error.value = "This document link is incomplete.";
      loading.value = false;
      return;
    }

    try {
      const opened = await openDocumentSession(node);
      if (request !== opening) {
        opened.dispose();
        return;
      }

      session.value = opened;
      surface.value = await selectDocumentSurface(opened, documentTypes);
      if (request !== opening) {
        opened.dispose();
        return;
      }

      await replaceDecorativeSlug(opened);
    } catch (reason) {
      if (request !== opening) return;
      if (isDriveLocked(reason)) {
        locked.value = true;
        return;
      }
      // A guest is never told whether the item exists.
      if (guestFrame && reason instanceof TransportError && [401, 403, 404, 410].includes(reason.status)) {
        guestFrame.requireSignIn();
        return;
      }
      error.value = reason instanceof Error ? reason.message : "This document could not be opened.";
    } finally {
      if (request === opening) loading.value = false;
    }
  },
  { immediate: true },
);

// An open document the server stops answering is asked once why. A `401 DriveLocked`
// means the unlock ticket expired: the unlock screen shows, and only a new password opens
// the document again. Any other refusal shows a guest the Sign-in screen, which never says
// whether the item exists, and shows a signed-in user the refusal surface. Nothing reopens
// by itself, so a server that keeps refusing cannot cause a loop.
watch(
  () => session.value?.state.value,
  async (state, before) => {
    if (state !== "Refused" || before !== "Active" || !session.value) return;
    const request = opening;
    const lapsed = session.value;
    const lockedAgain = await isDriveNodeLocked(lapsed.nodeId);
    if (request !== opening) return;
    if (!lockedAgain) {
      guestFrame?.requireSignIn();
      return;
    }
    opening += 1;
    session.value = null;
    surface.value = null;
    lapsed.dispose();
    loading.value = false;
    locked.value = true;
  },
);

watch(
  () => session.value?.title.value,
  () => {
    if (session.value) void replaceDecorativeSlug(session.value);
  },
);

async function replaceDecorativeSlug(opened: DocumentSession) {
  const canonical = driveNodeRoute(opened.nodeId, opened.title.value);
  const destination = { ...(canonical as Record<string, unknown>), query: route.query } as RouteLocationRaw;
  if (router.resolve(destination).path !== route.path) await router.replace(destination);
}

onBeforeUnmount(() => {
  opening += 1;
  session.value?.dispose();
});
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface-base text-ink-gray-8">
    <div v-if="loading" class="flex min-w-0 flex-1 flex-col">
      <DriveDocumentHeaderSkeleton :title="session?.title.value || openingTitle || undefined" />
    </div>

    <DriveUnlockScreen v-else-if="locked" :node="nodeId" @unlocked="reopen += 1" />

    <div v-else-if="error" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-circle-alert mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <h1 class="mt-3 text-lg-semibold">Could not open this document</h1>
      <p class="mt-1 text-p-sm text-ink-gray-6">{{ error }}</p>
    </div>

    <div v-else-if="refused" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-lock-keyhole mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <h1 class="mt-3 text-lg-semibold">You do not have access</h1>
      <p class="mt-1 text-p-sm text-ink-gray-6">Ask the owner for permission to read this document.</p>
    </div>

    <component
      :is="surface"
      v-else-if="surface && session"
      :key="session.nodeId"
      :session="session"
      class="h-full min-h-0 w-full min-w-0 overflow-hidden"
    />

    <div v-else class="m-auto max-w-md px-6 text-center">
      <span class="lucide-file-question mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <h1 class="mt-3 text-lg-semibold">No preview</h1>
      <p class="mt-1 text-p-sm text-ink-gray-6">This file type cannot be previewed here.</p>
      <Button class="mt-4" label="Download" icon-left="lucide-download" :link="downloadUrl" />
    </div>
  </div>
</template>
