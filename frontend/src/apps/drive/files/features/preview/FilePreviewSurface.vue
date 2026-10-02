<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import { Button, Dropdown } from "frappe-ui";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";

import { driveNodeRoute, useDriveDialogs } from "@/apps/drive";
import { children, starNode, unstarNode } from "@/apps/drive/client/nodes";
import type { DocumentSession } from "@/apps/drive/client/session";
import { DRIVE_ROLES } from "@/apps/drive/client/types";
import { useMutation, useQuery } from "@/platform/server-state";
import { useSession } from "@/platform/session";
import DocumentHeader from "../document/DocumentHeader.vue";
import { linkAccess } from "../linkAccess";
import { readPresentationPreference, resolvePresentation } from "../presentation";
import { useLocationTitle } from "../../internal/locations";
import type { FilePreviewSession } from "./session";
import UploadNewVersion from "./UploadNewVersion.vue";

const props = defineProps<{ session: DocumentSession }>();
const router = useRouter();
const dialogs = useDriveDialogs();
const locationTitle = useLocationTitle();
const file = computed(() => props.session as FilePreviewSession);
const mime = computed(() => file.value.mime ?? "");
const previewUrl = computed(() => file.value.preview.value?.url ?? "");
/** Bumped after a new version, so the browser fetches the new bytes. */
const revision = ref(0);
const contentUrl = computed(
  () =>
    `/api/suite/drive/nodes/${encodeURIComponent(props.session.nodeId)}/content` +
    (revision.value ? `?v=${revision.value}` : ""),
);
const role = computed(() => props.session.access.value.role ?? 0);
const active = computed(() => props.session.state.value === "Active");
const canEdit = computed(() => active.value && role.value >= DRIVE_ROLES.edit);
const parent = computed(() => file.value.parent.value);
const canReplace = computed(() => !!parent.value && canEdit.value);
const account = useSession();
const signedIn = computed(() => account.status.value === "authenticated");
// The listing's rule: a signed-in caller's own access, never a share link's.
const canStar = computed(() => active.value && linkAccess({ access: props.session.access.value }, signedIn.value).star);
const starMutation = useMutation(starNode());
const unstarMutation = useMutation(unstarNode());

const header = ref<{ focusTitle(): void } | null>(null);
const upload = ref<{ pick(): void } | null>(null);

const folder = computed(() => file.value.folder.value);
const location = computed(() => {
  const crumb = folder.value;
  if (!crumb) return null;
  const label = locationTitle(crumb);
  return { label, to: driveNodeRoute(crumb.name, label, "folder") };
});

// Previous and next walk the folder's files in the order the listing shows them
// by default: the saved sort, folders left out.
const order = resolvePresentation({}, readPresentationPreference());
const siblings = useQuery(() =>
  folder.value
    ? children({ node: folder.value.name, order_by: order.sort, ascending: order.dir === "asc", limit: 200 })
    : false,
);
const files = computed(() => siblings.rows.filter((row) => row.kind === "file" && row.state === "Active"));
const position = computed(() => files.value.findIndex((row) => row.name === props.session.nodeId));
const previous = computed(() => (position.value > 0 ? files.value[position.value - 1] : null));
const next = computed(() =>
  position.value !== -1 && position.value < files.value.length - 1 ? files.value[position.value + 1] : null,
);

function show(row: { name: string; title: string; kind: string } | null) {
  if (row) void router.push(driveNodeRoute(row));
}

// Arrow keys step through the folder unless something on the page has focus,
// such as the title field or a video's controls.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  if (document.activeElement && document.activeElement !== document.body) return;
  if (event.key === "ArrowLeft") show(previous.value);
  else if (event.key === "ArrowRight") show(next.value);
});

const menu = computed(() => [
  ...(canEdit.value
    ? [{ label: "Rename", icon: "lucide-pencil", onClick: () => header.value?.focusTitle() }]
    : []),
  ...(canEdit.value
    ? [{ label: "Move", icon: "lucide-folder-input", onClick: move }]
    : []),
  ...(canReplace.value
    ? [{ label: "Upload new version", icon: "lucide-upload", onClick: () => upload.value?.pick() }]
    : []),
  ...(canStar.value
    ? [{ label: file.value.favourite.value ? "Unstar" : "Star", icon: "lucide-star", onClick: toggleStar }]
    : []),
  { label: "Details", icon: "lucide-info", onClick: () => void dialogs.showDetails(props.session.nodeId) },
]);

/** The menu shows the new state at once, and the old one again if the server refuses. */
async function toggleStar() {
  const favourite = file.value.favourite;
  const starred = !favourite.value;
  favourite.value = starred;
  const result = await (starred ? starMutation : unstarMutation).run({ node: props.session.nodeId });
  if (!result) favourite.value = !starred;
}

async function move() {
  if (await dialogs.move(props.session.nodeId)) await file.value.refreshPreview();
}

async function replaced() {
  await file.value.refreshPreview();
  revision.value += 1;
}
const canPreview = computed(
  () =>
    !!previewUrl.value ||
    mime.value.startsWith("image/") ||
    mime.value.startsWith("audio/") ||
    mime.value.startsWith("video/") ||
    mime.value === "application/pdf" ||
    mime.value.startsWith("text/"),
);
/** Image types every browser draws. Others, such as HEIC or TIFF, show the server's preview. */
const WEB_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/svg+xml", "image/bmp"]);
const source = computed(() =>
  WEB_IMAGES.has(mime.value) || !previewUrl.value ? contentUrl.value : previewUrl.value,
);
</script>

<template>
  <div class="flex h-full min-h-0 w-full min-w-0 flex-col bg-surface-base">
    <DocumentHeader
      ref="header"
      :session="session"
      title-label="File name"
      :mime="file.mime"
      :location="location"
    >
      <template #status>
        <UploadNewVersion
          v-if="canReplace && parent"
          ref="upload"
          :node="session.nodeId"
          :parent="parent"
          :title="session.title.value"
          @replaced="replaced"
        />
      </template>
      <template #actions>
        <template v-if="files.length > 1 && position !== -1">
          <Button
            variant="ghost"
            icon="lucide-chevron-left"
            tooltip="Previous file"
            aria-label="Previous file"
            :disabled="!previous"
            @click="show(previous)"
          />
          <span class="text-sm tabular-nums text-ink-gray-5 max-md:hidden">{{ position + 1 }} of {{ files.length }}</span>
          <Button
            variant="ghost"
            icon="lucide-chevron-right"
            tooltip="Next file"
            aria-label="Next file"
            :disabled="!next"
            @click="show(next)"
          />
        </template>
        <Button variant="ghost" icon="lucide-download" tooltip="Download" aria-label="Download" :href="contentUrl" />
        <Dropdown :options="menu" align="end">
          <Button variant="ghost" icon="lucide-ellipsis" tooltip="More file actions" aria-label="More file actions" />
        </Dropdown>
      </template>
    </DocumentHeader>
    <div v-if="!canPreview" class="m-auto max-w-md px-6 text-center">
      <span class="lucide-file-question mx-auto block size-6 text-ink-gray-5" aria-hidden="true" />
      <h2 class="mt-3 text-lg-semibold">No preview</h2>
      <p class="mt-1 text-p-sm text-ink-gray-6">Download this file to open it.</p>
      <Button class="mt-4" label="Download" icon-left="lucide-download" :href="contentUrl" />
    </div>
    <img v-else-if="mime.startsWith('image/')" :src="source" :alt="session.title.value" class="m-auto max-h-full min-h-0 max-w-full object-contain p-4" />
    <audio v-else-if="mime.startsWith('audio/')" :src="contentUrl" controls class="m-auto w-full max-w-xl" />
    <video v-else-if="mime.startsWith('video/')" :src="contentUrl" controls class="m-auto max-h-full min-h-0 max-w-full" />
    <iframe v-else :src="contentUrl" :title="session.title.value" class="min-h-0 flex-1 border-0 bg-surface-base" />
  </div>
</template>
