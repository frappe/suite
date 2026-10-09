import {
  CollabOpenError,
  isRecoverable,
  type Blocked,
  type CollabRoom,
  type LiveState,
} from '@suite/collab-client'
import { computed, nextTick, ref, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { openWriterRoom } from '@/apps/writer/collab'
import { TransportError } from '@/platform/transport'

import { bannerFor, openFailureFor, type BannerState } from './collabMessages'
import type { DocumentSaveState } from './navigation'

export type CollabMode = 'opening' | 'legacy' | 'live' | 'failed'

interface RoomStatus {
  saveState: DocumentSaveState
  canWrite: boolean
  blocked: Blocked | null
  paused: string | null
  stopped: string | null
  held: string | null
  newerSchema: boolean
  unsent: number
  onDevice: boolean
  atLimit: boolean
  live: LiveState | null
}

const readStatus = (room: CollabRoom): RoomStatus => ({
  saveState: room.saveState,
  canWrite: room.canWrite,
  blocked: room.blocked,
  paused: room.paused,
  stopped: room.stopped,
  held: room.held,
  newerSchema: room.newerSchema,
  unsent: room.unsent,
  onDevice: room.onDevice,
  atLimit: room.atLimit,
  live: room.live,
})

// A Writer document's live room: opening it, mirroring its state for the page, and closing it.
// `retainRecovery` keeps the editor's HTML in this browser when the room stops holding unsent work.
// `mayEdit` is whether the person may edit the document
export function useWriterCollab(
  session: DocumentSession,
  retainRecovery: () => boolean,
  mayEdit: () => boolean,
) {
  const mode = shallowRef<CollabMode>('opening')
  const room = shallowRef<CollabRoom | null>(null)
  const status = shallowRef<RoomStatus | null>(null)
  const openReason = ref<string | null>(null)
  const openStatus = ref<number | null>(null)
  const recoveryKept = ref(false)
  const setAside = ref(false)
  let stopWatching = () => {}
  let closed = false

  async function open() {
    mode.value = 'opening'
    openReason.value = null
    openStatus.value = null

    try {
      const opened = await openWriterRoom(session)
      if (closed) {
        if (opened.state === 'live') {
          void opened.room.close()
        }
        return
      }

      if (opened.state !== 'live') {
        mode.value = 'legacy'
        return
      }

      const liveRoom = opened.room
      room.value = liveRoom
      recoveryKept.value = false
      stopWatching = liveRoom.onChange(() => syncRoomStatus(liveRoom))
      syncRoomStatus(liveRoom)
      mode.value = 'live'
    } catch (error) {
      const hasReason = error instanceof CollabOpenError
      const hasStatus = hasReason || error instanceof TransportError
      openReason.value = hasReason ? error.reason : null
      openStatus.value = hasStatus ? error.status : null
      mode.value = 'failed'
    }
  }

  // Mirrors the room's state for the page, or rebuilds the room once it asks for that
  function syncRoomStatus(liveRoom: CollabRoom) {
    if (liveRoom.needsRebuild) {
      const unsentNowhereElse = liveRoom.unsent && !liveRoom.onDevice
      if (unsentNowhereElse && !recoveryKept.value) {
        recoveryKept.value = retainRecovery()
      }

      // Unsent work held nowhere else stays on screen in the old room until it is sent
      if (!unsentNowhereElse || recoveryKept.value) {
        void rebuildRoom(liveRoom)
        return
      }
    }

    const stopped =
      liveRoom.saveState === 'failed' || (liveRoom.blocked && !isRecoverable(liveRoom.blocked))
    if (stopped && liveRoom.unsent && !recoveryKept.value) {
      recoveryKept.value = retainRecovery()
    }
    status.value = readStatus(liveRoom)
  }

  // The editor goes before the old room, so nothing typed lands in a room that no longer sends.
  // The old room sends what it can; the new one takes the rest over from the device
  async function rebuildRoom(oldRoom: CollabRoom) {
    stopWatching()
    setAside.value = !!(oldRoom.stopped && oldRoom.unsent)
    room.value = null
    mode.value = 'opening'
    await nextTick()
    await oldRoom.close()
    if (!closed) {
      await open()
    }
  }

  function close() {
    closed = true
    stopWatching()
    void room.value?.close()
  }

  const isLive = computed(() => mode.value === 'live')
  // Whether the person can type: "paused" for a reason that clears, "closed" when they can't (or lost the right to).
  // "editing" while there is no room to ask
  const editingState = computed<'editing' | 'paused' | 'closed'>(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) return 'editing'

    const lostAccess = roomStatus.blocked === 'lost_edit' || roomStatus.blocked === 'lost_read'
    if (lostAccess) return 'closed'

    const stopped = roomStatus.saveState === 'failed' || roomStatus.blocked === 'offline'
    if (stopped) return 'paused'

    if (roomStatus.canWrite) return 'editing'

    const waiting = roomStatus.blocked || roomStatus.paused || roomStatus.held
    if (waiting) return 'paused'

    return 'closed'
  })
  const allowsEditing = computed(() => editingState.value === 'editing')
  const editingPaused = computed(() => editingState.value === 'paused')
  const saveState = computed(() => (isLive.value ? (status.value?.saveState ?? 'clean') : null))
  const unsent = computed(() => (isLive.value ? (status.value?.unsent ?? 0) : 0))
  const paused = computed(() => (isLive.value ? (status.value?.paused ?? null) : null))
  const banner = computed(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) return null

    const bannerState: BannerState = {
      ...roomStatus,
      canEdit: mayEdit(),
      failed: roomStatus.saveState === 'failed',
      recoveryKept: recoveryKept.value,
      setAside: setAside.value,
      polling: roomStatus.live === 'polling',
    }
    return bannerFor(bannerState)
  })
  const openFailure = computed(() => openFailureFor(openReason.value, openStatus.value))

  return {
    mode,
    room,
    isLive,
    allowsEditing,
    editingPaused,
    saveState,
    unsent,
    paused,
    banner,
    openFailure,
    open,
    close,
  }
}
