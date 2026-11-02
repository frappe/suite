import { computed, nextTick, ref, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { writerAdapter } from '@/apps/writer/collab/adapter'
import { watchRemovals, type Removal } from '@/apps/writer/collab/removals'
import { keepRemovedWork } from '@/apps/writer/recovery/copies'
import {
  CollabOpenError,
  isRecoverable,
  openCollabRoom,
  type CollabRoom,
  type LostAccess,
  type Opened,
  type RoomStatus,
} from '@/platform/collab'
import { TransportError } from '@/platform/transport'

import { bannerFor, isKeptNowhere, openFailureFor, type BannerState } from './collabMessages'
import { markNewerSchemaShown } from './newerSchemaMark'

export type CollabMode = 'opening' | 'readonly' | 'unconverted' | 'live' | 'failed'

type EditingState = 'editing' | 'paused' | 'closed'

// Whether the person can type: "paused" for a reason that clears, "closed" when they can't (or lost the right to)
function editingStateOf(roomStatus: RoomStatus): EditingState {
  const hasLostAccess =
    roomStatus.blockReason === 'lost_edit' || roomStatus.blockReason === 'lost_read'
  if (hasLostAccess) {
    return 'closed'
  }

  const hasStopped = roomStatus.saveState === 'failed' || roomStatus.blockReason === 'offline'
  if (hasStopped) {
    return 'paused'
  }

  if (roomStatus.canWrite) {
    return 'editing'
  }

  const waiting =
    roomStatus.blockReason ||
    roomStatus.pauseReason ||
    roomStatus.holdReason ||
    roomStatus.isRestoring
  if (waiting) {
    return 'paused'
  }

  return 'closed'
}

// A Writer document's live room: opening it, mirroring its state for the page, and closing it
// `retainRecovery` keeps the editor's HTML in this browser when the room stops holding unsent work
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
  const removedWork = ref<'kept' | 'unkept' | null>(null)
  const removedCopies = ref(0)
  const isNewerAfterReload = ref(false)
  let isNewerSchemaMarked = false
  let stopWatching = () => {}

  let isClosed = false

  function settleOpened(opened: Opened, stopRemovals: (() => void) | undefined) {
    if (isClosed) {
      stopRemovals?.()
      if (opened.state === 'live') {
        void opened.room.close()
      }

      return
    }

    if (opened.state !== 'live') {
      stopRemovals?.()
      mode.value = opened.state === 'unconverted' ? 'unconverted' : 'readonly'
      return
    }

    const liveRoom = opened.room
    room.value = liveRoom
    recoveryKept.value = false
    const stopStatus = liveRoom.onChange(() => syncRoomStatus(liveRoom))
    stopWatching = () => {
      stopStatus()
      stopRemovals?.()
    }

    syncRoomStatus(liveRoom)
    mode.value = 'live'
  }

  function setOpenFailure(error: unknown) {
    const hasReason = error instanceof CollabOpenError
    const hasStatus = hasReason || error instanceof TransportError
    openReason.value = hasReason ? error.reason : null
    openStatus.value = hasStatus ? error.status : null
    mode.value = 'failed'
  }

  async function open() {
    mode.value = 'opening'
    openReason.value = null
    openStatus.value = null

    let stopRemovals: (() => void) | undefined
    try {
      const opened = await openCollabRoom({
        session,
        adapter: writerAdapter,
        onThreadsChanged: threadsChanged,
        watch: (openingRoom) => {
          stopRemovals = watchRemovals(openingRoom, keepRemovals)
        },
      })
      settleOpened(opened, stopRemovals)
    } catch (error) {
      stopRemovals?.()
      setOpenFailure(error)
    }
  }

  async function keepRemovals(removals: Removal[]) {
    const kept = await keepRemovedWork(session.nodeId, session.title.value, removals)
    if (kept === 'kept') {
      removedCopies.value++
    }

    // A later kept copy mustn't hide that earlier text couldn't be kept
    if (removedWork.value !== 'unkept') {
      removedWork.value = kept ?? removedWork.value
    }
  }

  // Mirrors the room's state for the page, or rebuilds the room once it asks for that
  function syncRoomStatus(liveRoom: CollabRoom) {
    const liveStatus = liveRoom.status
    if (liveStatus.isReopenNeeded) {
      if (isKeptNowhere(liveStatus, recoveryKept.value)) {
        recoveryKept.value = retainRecovery()
      }

      // Unsent work held nowhere else stays on screen in the old room until it is sent
      if (!isKeptNowhere(liveStatus, recoveryKept.value)) {
        void rebuildRoom(liveRoom)
        return
      }
    }

    const { blockReason } = liveStatus
    const hasStopped =
      liveStatus.saveState === 'failed' || (blockReason && !isRecoverable(blockReason))
    if (hasStopped && liveStatus.unsentCount && !recoveryKept.value) {
      recoveryKept.value = retainRecovery()
    }

    if (liveStatus.hasNewerSchema && !isNewerSchemaMarked) {
      isNewerSchemaMarked = true
      isNewerAfterReload.value = markNewerSchemaShown(session.nodeId)
    }

    status.value = liveStatus
  }

  // The editor goes before the old room, so nothing typed lands in a room that no longer sends
  // The old room sends what it can; the new one takes the rest over from the device
  async function rebuildRoom(oldRoom: CollabRoom) {
    stopWatching()
    setAside.value = null
    const { unsentCount, stopReason } = oldRoom.status
    if (unsentCount) {
      setAside.value = stopReason
    }

    room.value = null
    mode.value = 'opening'
    await nextTick()
    await oldRoom.close()
    if (!isClosed) {
      await open()
    }
  }

  function close() {
    isClosed = true
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
  // "editing" while there is no room to ask
  const editingState = computed<EditingState>(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return 'editing'
    }

    return editingStateOf(roomStatus)
  })
  const allowsEditing = computed(() => editingState.value === 'editing')
  const editingPaused = computed(() => editingState.value === 'paused')
  const saveState = computed(() => {
    if (!isLive.value) {
      return null
    }

    return status.value?.saveState ?? 'clean'
  })
  // Counts what other tabs of this document keep on the device too, as the save state does
  const unsent = computed(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return 0
    }

    return roomStatus.unsentCount + roomStatus.othersUnsentCount
  })
  const paused = computed(() => {
    if (!isLive.value) {
      return null
    }

    return status.value?.pauseReason ?? null
  })
  const copiesKept = computed(() => (status.value?.keptCopyCount ?? 0) + removedCopies.value)
  const banner = computed(() => {
    const roomStatus = status.value
    if (!isLive.value || !roomStatus) {
      return null
    }

    const bannerState: BannerState = {
      ...roomStatus,
      canEdit: mayEdit(),
      hasFailed: roomStatus.saveState === 'failed',
      isRecoveryKept:
        recoveryKept.value || (roomStatus.keptCopyCount > 0 && !roomStatus.hasCopyFailed),
      setAside: setAside.value,
      removedWork: removedWork.value,
      isPolling: roomStatus.liveState === 'polling',
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
