import { computed, readonly, ref, type Ref } from "vue";

import { onAccessChange } from "@/apps/drive/client/accessChanges";
import { api } from "@/apps/drive/client/generated";
import { driveOperation } from "@/apps/drive/client/operation";
import {
  canShare,
  documentCredentials,
  type DocumentSession,
  type MediaHandle,
} from "@/apps/drive/client/session";
import type { DriveBreadcrumb, DriveNode, DrivePreview } from "@/apps/drive/client/types";
import { onTouch } from "@/platform/server-state";
import { transport } from "@/platform/transport";
import { presentShareDialog } from "../share/present";

const nodeGet = driveOperation<{ node: string; expand?: string }, DriveNode>(api.node_get, { entity: true });
const renameNode = driveOperation<{ node: string; title: string }, DriveNode>(api.node_patch.rename, { entity: true });
const copyNode = driveOperation<{ node: string; parent: string; title?: string }, DriveNode>(api.node_copy, { entity: true });
const EXPAND = "access,preview,breadcrumbs";

export interface FilePreviewSession extends DocumentSession {
  readonly mime: string | null;
  /** The file's size in bytes. Follows a new version. */
  readonly size: Readonly<Ref<number>>;
  /** The id of the folder the file is in. A replace names it; `null` for a root. Follows a move. */
  readonly parent: Readonly<Ref<string | null>>;
  /**
   * The folder the file is in, when the caller can read it: the header links
   * back to it. Follows a move.
   */
  readonly folder: Readonly<Ref<DriveBreadcrumb | null>>;
  /** The root the file is in. A restore whose folder is gone picks a folder in it. */
  readonly root: string;
  /** The node whose trashing trashed the file: the file itself, a folder it is in, or `null` while Active. Follows a refresh. */
  readonly trashRoot: Readonly<Ref<string | null>>;
  readonly preview: Readonly<Ref<DrivePreview | null>>;
  /**
   * The caller's own star on the file. Writable, so a star toggle can show
   * the new state before the server answers and put it back on a refusal.
   */
  readonly favourite: Ref<boolean>;
  refreshPreview(): Promise<void>;
}

export async function openFilePreviewSession(nodeId: string): Promise<FilePreviewSession> {
  const controller = new AbortController();
  const initial = await transport.request(nodeGet, { node: nodeId, expand: EXPAND }, { signal: controller.signal });
  if (initial.kind !== "file" || initial.content_doctype || initial.content_docname) {
    throw new Error(`Drive node ${nodeId} is not a previewable file`);
  }

  const title = ref(initial.title);
  const state = ref<"Active" | "Trashed" | "Refused">(sessionState(initial));
  const access = ref(initial.access ?? {});
  const preview = ref<DrivePreview | null>(initial.preview ?? null);
  const parent = ref(initial.parent);
  const folder = ref<DriveBreadcrumb | null>(folderOf(initial));
  const trashRoot = ref(initial.trash_root);
  const favourite = ref(initial.favourite ?? false);
  const size = ref(initial.size);
  let disposed = false;
  /** Counts reads, so an answer that comes back after a newer one never puts older state back. */
  let reads = 0;

  // A file reached through a share link records no visit (spec §10.13): the
  // same rule as the document session and `isLinkOnly`.
  if (!initial.access?.via_link) void request<Record<string, never>>(api.node_visit, { node: nodeId }).catch(() => {});

  async function refresh() {
    if (disposed) return;
    const read = ++reads;
    try {
      const node = await transport.request(nodeGet, { node: nodeId, expand: EXPAND }, { signal: controller.signal });
      if (read !== reads) return;
      title.value = node.title;
      parent.value = node.parent;
      folder.value = folderOf(node);
      trashRoot.value = node.trash_root;
      access.value = node.access ?? {};
      state.value = sessionState(node);
      preview.value = node.preview ?? null;
      favourite.value = node.favourite ?? false;
      size.value = node.size;
    } catch {
      if (read !== reads || disposed) return;
      state.value = "Refused";
      access.value = {};
      preview.value = null;
    }
  }

  function request<Output>(operation: any, input: Record<string, unknown>) {
    return transport.request(
      driveOperation<Record<string, unknown>, Output>(operation, { looseInput: true, covers: [nodeId] }),
      input,
      { signal: controller.signal },
    );
  }

  const media: MediaHandle = {
    id: nodeId,
    src: readonly(ref(initial.url)),
    cacheKey: readonly(ref(`drive-file:${nodeId}`)),
    status: readonly(ref(initial.url ? "ready" : "refused")),
    refresh,
  };
  const accessTimer = window.setInterval(() => void refresh(), 5 * 60_000);
  const previewTimer = window.setInterval(() => void refresh(), 10 * 60_000);
  const onFocus = () => void refresh();
  window.addEventListener("focus", onFocus);
  const stopAccessChanges = onAccessChange(nodeId, () => void refresh());
  // A move, trash, restore or undo made anywhere names the file in `touches`.
  const stopTouches = onTouch(nodeId, () => void refresh());

  return {
    nodeId,
    contentDoctype: "File",
    contentDocname: nodeId,
    mime: initial.mime,
    size: readonly(size),
    parent: readonly(parent),
    folder: readonly(folder),
    root: initial.root,
    trashRoot: readonly(trashRoot),
    preview: readonly(preview),
    favourite,
    title: readonly(title),
    state: readonly(state),
    access: readonly(access),
    canShare: computed(() => canShare(state.value, access.value)),
    async rename(nextTitle) {
      const node = await transport.request(renameNode, { node: nodeId, title: nextTitle }, { signal: controller.signal });
      // A read already on its way may predate the rename, so its answer is dropped.
      reads += 1;
      title.value = node.title;
      return node;
    },
    async share() {
      await presentShareDialog(nodeId);
      await refresh();
    },
    copy: (parent, nextTitle) => transport.request(copyNode, { node: nodeId, parent, title: nextTitle }, { signal: controller.signal }),
    comments: {
      list: (resolved) => request(api.node_threads, { node: nodeId, resolved }),
      create: (anchor, text, authorName) => request(api.node_thread_create, { node: nodeId, anchor, text, author_name: authorName }),
      reply: (thread, text, authorName) => request(api.thread_comment_create, { thread, text, author_name: authorName }),
      resolve: (thread, resolved) => request(api.thread_patch, { thread, resolved }),
      edit: (comment, text) => request(api.comment_patch, { comment, text }),
      remove: (comment) => request(api.comment_delete, { comment }),
    },
    versions: {
      list: (cursor) => request(api.node_versions, { node: nodeId, cursor }),
      create: (kind, label) => request(api.node_version_create, { node: nodeId, kind, label }),
      update: (seq, changes) => request(api.node_version_patch, { node: nodeId, seq, ...changes }),
      remove: (seq) => request(api.node_version_delete, { node: nodeId, seq }),
      contentUrl: (seq) => `/api/suite/drive/nodes/${encodeURIComponent(nodeId)}/versions/${encodeURIComponent(seq)}/content`,
      restore: (seq) => request(api.node_version_restore, { node: nodeId, seq }),
    },
    media: () => media,
    credentials: documentCredentials(nodeId),
    refreshAccess: refresh,
    refreshPreview: refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      controller.abort();
      window.clearInterval(accessTimer);
      window.clearInterval(previewTimer);
      window.removeEventListener("focus", onFocus);
      stopAccessChanges();
      stopTouches();
    },
  };
}

/** The breadcrumbs end at the file's own folder, when the caller can read it. */
function folderOf(node: DriveNode): DriveBreadcrumb | null {
  const parent = node.breadcrumbs?.at(-1);
  return parent && parent.name === node.parent ? parent : null;
}

function sessionState(node: DriveNode): "Active" | "Trashed" | "Refused" {
  if ((node.access?.role ?? 0) < 10) return "Refused";
  return node.state === "Trashed" ? "Trashed" : "Active";
}
