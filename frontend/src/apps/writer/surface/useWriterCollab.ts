import {
  CollabOpenError,
  isRecoverable,
  type CollabRoom,
  type LostAccess,
} from '@suite/collab-client'
import { computed, nextTick, ref, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { openWriterRoom } from '@/apps/writer/collab'
import { TransportError } from '@/platform/transport'

import { bannerFor, isKeptNowhere, openFailureFor, type BannerState } from './collabMessages'
import { markNewerSchemaShown } from './newerSchemaMark'

export type CollabMode = 'opening' | 'legacy' | 'live' | 'failed'

const STATUS_FIELDS = [
  'saveState',
  'canWrite',
  'blocked',
  'paused',
  'stopped',
  'copiesKept',
  'copyFailed',
  'held',
  'restoring',
  'newerSchema',
  'unsent',
  'othersUnsent',
  'onDevice',
  'atLimit',
  'live',
] as const satisfies readonly (keyof CollabRoom)[]

type RoomStatus = Pick<CollabRoom, (typeof STATUS_FIELDS)[number]>

// A snapshot, since the room's getters change under the page
function readStatus(room: CollabRoom) {
  const entries = STATUS_FIELDS.map((field) => [field, room[field]])
  return Object.fromEntries(entries) as RoomStatus
}

// A Writer document's live room: opening it, mirroring its state for the page, and closing it.
// `retainRecovery` keeps the editor's HTML in this browser when the room stops holding unsent work.
// `mayEdit` is whether the person may edit the document. `threadsChanged` is told when its comment threads may have changed
// `isFrozen` is whether the editor met content it can't show
export function useWriterCollab(
  session: DocumentSession,
  retainRecovery: () => boolean,
  mayEdit: () => boolean,
  threadsChanged: () => void,
  isFrozen: () => boolean,
) {
  const mode = shallowRef<CollabMode>('opening')
  const room = shallowRef<CollabRoom | null>(null)
  const status = shallowRef<RoomStatus | null>(null)
  const openReason = ref<string | null>(null)
  const openStatus = ref<number | null>(null)
  const recoveryKept = ref(false)
  const setAside = ref<string | null>(null)
  const isNewerAfterReload = ref(false)
  let isNewerSchemaMarked = false
  let stopWatching = () => {}
  let closed = false

  async function open() {
    mode.value = 'opening'
    openReason.value = null
    openStatus.value = null

    try {
      const opened = await openWriterRoom(session, threadsChanged)
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
      if (isKeptNowhere(liveRoom, recoveryKept.value)) {
        recoveryKept.value = retainRecovery()
      }

      // Unsent work held nowhere else stays on screen in the old room until it is sent
      if (!isKeptNowhere(liveRoom, recoveryKept.value)) {
        void rebuildRoom(liveRoom)
        return
      }
    }

    const stopped =
      liveRoom.saveState === 'failed' || (liveRoom.blocked && !isRecoverable(liveRoom.blocked))
    if (stopped && liveRoom.unsent && !recoveryKept.value) {
      recoveryKept.value = retainRecovery()
    }

    if (liveRoom.newerSchema && !isNewerSchemaMarked) {
      isNewerSchemaMarked = true
      isNewerAfterReload.value = markNewerSchemaShown(session.nodeId)
    }
    status.value = readStatus(liveRoom)
  }

  // The editor goes before the old room, so nothing typed lands in a room that no longer sends.
  // The old room sends what it can; the new one takes the rest over from the device
  async function rebuildRoom(oldRoom: CollabRoom) {
    stopWatching()
    setAside.value = null
    if (oldRoom.unsent) {
      setAside.value = oldRoom.stopped
    }
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

  // Before the page drops the editor, so the room keeps its work rather than leaving it to another tab
  async function loseAccess(lostAccess: LostAccess) {
    await room.value?.loseAccess(lostAccess)
  }

  async function regainAccess() {
    await room.value?.regainAccess(mayEdit)
  }

  const isLive = computed(() => mode.value === 'live')
  // Whether the person can type: "paused" for a reason that clears, "closed" when they can't (or lost the right to).
  // "editing" while there is no room to ask
  const editingState = computed<'editing' | 'paused' | 'closed'>(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return 'editing'
    }

    const lostAccess = roomStatus.blocked === 'lost_edit' || roomStatus.blocked === 'lost_read'
    if (lostAccess) {
      return 'closed'
    }

    const stopped = roomStatus.saveState === 'failed' || roomStatus.blocked === 'offline'
    if (stopped) {
      return 'paused'
    }

    if (roomStatus.canWrite) {
      return 'editing'
    }

    const waiting =
      roomStatus.blocked || roomStatus.paused || roomStatus.held || roomStatus.restoring
    if (waiting) {
      return 'paused'
    }

    return 'closed'
  })
  const allowsEditing = computed(() => editingState.value === 'editing')
  const editingPaused = computed(() => editingState.value === 'paused')
  const saveState = computed(() => (isLive.value ? (status.value?.saveState ?? 'clean') : null))
  // Counts what other tabs of this document keep on the device too, as the save state does
  const unsent = computed(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return 0
    }

    return roomStatus.unsent + roomStatus.othersUnsent
  })
  const paused = computed(() => (isLive.value ? (status.value?.paused ?? null) : null))
  const copiesKept = computed(() => status.value?.copiesKept ?? 0)
  const banner = computed(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return null
    }

    const bannerState: BannerState = {
      ...roomStatus,
      canEdit: mayEdit(),
      failed: roomStatus.saveState === 'failed',
      recoveryKept: recoveryKept.value || (roomStatus.copiesKept > 0 && !roomStatus.copyFailed),
      setAside: setAside.value,
      polling: roomStatus.live === 'polling',
      isNewerAfterReload: isNewerAfterReload.value,
      isFrozen: isFrozen(),
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
    copiesKept,
    banner,
    openFailure,
    open,
    close,
    loseAccess,
    regainAccess,
  }
}
