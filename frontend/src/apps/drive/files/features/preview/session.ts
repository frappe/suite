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
import type { DriveNode, DrivePreview } from "@/apps/drive/client/types";
import { transport } from "@/platform/transport";
import { presentShareDialog } from "../share/present";

const nodeGet = driveOperation<{ node: string; expand?: string }, DriveNode>(api.node_get, { entity: true });
const renameNode = driveOperation<{ node: string; title: string }, DriveNode>(api.node_patch.rename, { entity: true });
const copyNode = driveOperation<{ node: string; parent: string; title?: string }, DriveNode>(api.node_copy, { entity: true });

export interface FilePreviewSession extends DocumentSession {
  readonly mime: string | null;
  readonly preview: Readonly<Ref<DrivePreview | null>>;
  refreshPreview(): Promise<void>;
}

export async function openFilePreviewSession(nodeId: string): Promise<FilePreviewSession> {
  const controller = new AbortController();
  const initial = await transport.request(nodeGet, { node: nodeId, expand: "access,preview" }, { signal: controller.signal });
  if (initial.kind !== "file" || initial.content_doctype || initial.content_docname) {
    throw new Error(`Drive node ${nodeId} is not a previewable file`);
  }

  const title = ref(initial.title);
  const state = ref<"Active" | "Trashed" | "Refused">(sessionState(initial));
  const access = ref(initial.access ?? {});
  const preview = ref<DrivePreview | null>(initial.preview ?? null);
  let disposed = false;

  void request<Record<string, never>>(api.node_visit, { node: nodeId }).catch(() => {});

  async function refresh() {
    if (disposed) return;
    try {
      const node = await transport.request(nodeGet, { node: nodeId, expand: "access,preview" }, { signal: controller.signal });
      title.value = node.title;
      access.value = node.access ?? {};
      state.value = sessionState(node);
      preview.value = node.preview ?? null;
    } catch {
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

  return {
    nodeId,
    contentDoctype: "File",
    contentDocname: nodeId,
    mime: initial.mime,
    preview: readonly(preview),
    title: readonly(title),
    state: readonly(state),
    access: readonly(access),
    canShare: computed(() => canShare(state.value, access.value)),
    async rename(nextTitle) {
      const node = await transport.request(renameNode, { node: nodeId, title: nextTitle }, { signal: controller.signal });
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
    },
  };
}

function sessionState(node: DriveNode): "Active" | "Trashed" | "Refused" {
  if ((node.access?.role ?? 0) < 10) return "Refused";
  return node.state === "Trashed" ? "Trashed" : "Active";
}
