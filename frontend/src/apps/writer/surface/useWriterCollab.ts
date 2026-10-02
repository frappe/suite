import { CollabOpenError, recoverable, type Blocked, type CollabRoom } from "@suite/collab-client";
import { computed, ref, shallowRef } from "vue";
import type { DocumentSession } from "@/apps/drive";
import { openWriterRoom } from "@/apps/writer/collab";
import { bannerFor, openFailureFor } from "./collabMessages";
import type { DocumentSaveState } from "./navigation";

export type CollabMode = "opening" | "legacy" | "live" | "failed";

interface RoomStatus {
  saveState: DocumentSaveState;
  canWrite: boolean;
  blocked: Blocked | null;
  paused: string | null;
  unsent: number;
  onDevice: boolean;
}

const snapshot = (room: CollabRoom): RoomStatus => ({
  saveState: room.saveState,
  canWrite: room.canWrite,
  blocked: room.blocked,
  paused: room.paused,
  unsent: room.unsent,
  onDevice: room.onDevice,
});

// A Writer document's live room: opening it, mirroring its state for the page, and closing it.
// `retainRecovery` keeps the editor's HTML in this browser when the room stops holding unsent work
export function useWriterCollab(session: DocumentSession, retainRecovery: () => boolean) {
  const mode = shallowRef<CollabMode>("opening");
  const room = shallowRef<CollabRoom | null>(null);
  const status = shallowRef<RoomStatus | null>(null);
  const openReason = ref<string | null>(null);
  const kept = ref(false);
  let stopWatching = () => {};
  let closed = false;

  async function open() {
    mode.value = "opening";
    openReason.value = null;
    try {
      const opened = await openWriterRoom(session);
      if (closed) {
        if (opened.state === "live") void opened.room.close();
        return;
      }
      if (opened.state !== "live") {
        mode.value = "legacy";
        return;
      }
      const live = opened.room;
      room.value = live;
      const sync = () => {
        const stopped = live.saveState === "failed" || (live.blocked && !recoverable(live.blocked));
        if (stopped && live.unsent && !kept.value) kept.value = retainRecovery();
        status.value = snapshot(live);
      };
      stopWatching = live.onChange(sync);
      sync();
      mode.value = "live";
    } catch (error) {
      openReason.value = error instanceof CollabOpenError ? error.reason : null;
      mode.value = "failed";
    }
  }

  function close() {
    closed = true;
    stopWatching();
    void room.value?.close();
  }

  const live = computed(() => mode.value === "live");
  // Whether the room lets the person type; true while there is no room to ask
  const allowsEditing = computed(() => {
    const now = status.value;
    return !live.value || !now || (now.canWrite && now.saveState !== "failed" && now.blocked !== "offline");
  });
  const saveState = computed(() => (live.value ? (status.value?.saveState ?? "clean") : null));
  const unsent = computed(() => (live.value ? (status.value?.unsent ?? 0) : 0));
  const paused = computed(() => (live.value ? status.value?.paused ?? null : null));
  const banner = computed(() => {
    const now = status.value;
    if (!live.value || !now || !(now.blocked || now.saveState === "failed")) return null;
    return bannerFor({ blocked: now.blocked, onDevice: now.onDevice, kept: kept.value });
  });
  const openFailure = computed(() => openFailureFor(openReason.value));

  return { mode, room, live, allowsEditing, saveState, unsent, paused, banner, openFailure, open, close };
}
