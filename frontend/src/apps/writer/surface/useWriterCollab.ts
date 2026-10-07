import { CollabOpenError, recoverable, type Blocked, type CollabRoom } from '@suite/collab-client'
import { computed, nextTick, ref, shallowRef } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { openWriterRoom } from '@/apps/writer/collab'
import { TransportError } from '@/platform/transport'

import { bannerFor, openFailureFor } from './collabMessages'
import type { DocumentSaveState } from './navigation'

export type CollabMode = 'opening' | 'legacy' | 'live' | 'failed'

interface RoomStatus {
  saveState: DocumentSaveState
  canWrite: boolean
  blocked: Blocked | null
  paused: string | null
  stopped: string | null
  unsent: number
  onDevice: boolean
}

const snapshot = (room: CollabRoom): RoomStatus => ({
  saveState: room.saveState,
  canWrite: room.canWrite,
  blocked: room.blocked,
  paused: room.paused,
  stopped: room.stopped,
  unsent: room.unsent,
  onDevice: room.onDevice,
})

// A Writer document's live room: opening it, mirroring its state for the page, and closing it.
// `retainRecovery` keeps the editor's HTML in this browser when the room stops holding unsent work
export function useWriterCollab(session: DocumentSession, retainRecovery: () => boolean) {
  const mode = shallowRef<CollabMode>('opening')
  const room = shallowRef<CollabRoom | null>(null)
  const status = shallowRef<RoomStatus | null>(null)
  const openReason = ref<string | null>(null)
  const openStatus = ref<number | null>(null)
  const kept = ref(false)
  let stopWatching = () => {}
  let closed = false

  async function open() {
    mode.value = 'opening'
    openReason.value = null
    openStatus.value = null
    try {
      const opened = await openWriterRoom(session)
      if (closed) {
        if (opened.state === 'live') void opened.room.close()
        return
      }
      if (opened.state !== 'live') {
        mode.value = 'legacy'
        return
      }
      const live = opened.room
      room.value = live
      const sync = () => {
        if (live.stale) return void rebuild(live)
        const stopped = live.saveState === 'failed' || (live.blocked && !recoverable(live.blocked))
        if (stopped && live.unsent && !kept.value) kept.value = retainRecovery()
        status.value = snapshot(live)
      }
      stopWatching = live.onChange(sync)
      sync()
      mode.value = 'live'
    } catch (error) {
      openReason.value = error instanceof CollabOpenError ? error.reason : null
      openStatus.value =
        error instanceof CollabOpenError || error instanceof TransportError ? error.status : null
      mode.value = 'failed'
    }
  }

  // The editor goes before the old room, so nothing typed lands in a room that no longer sends.
  // The old room sends what it can; the new one takes the rest over from the device
  async function rebuild(old: CollabRoom) {
    stopWatching()
    if (old.unsent && !old.onDevice && !kept.value) kept.value = retainRecovery()
    room.value = null
    mode.value = 'opening'
    await nextTick()
    await old.close()
    if (!closed) await open()
  }

  function close() {
    closed = true
    stopWatching()
    void room.value?.close()
  }

  const live = computed(() => mode.value === 'live')
  // Whether the person can type: "paused" for a reason that clears, "closed" when they can't (or lost the right to).
  // "editing" while there is no room to ask
  const standing = computed<'editing' | 'paused' | 'closed'>(() => {
    const now = status.value
    if (!live.value || !now) return 'editing'
    if (now.blocked === 'lost_edit' || now.blocked === 'lost_read') return 'closed'
    const stopped = now.saveState === 'failed' || now.blocked === 'offline'
    if (now.canWrite) return stopped ? 'paused' : 'editing'
    return stopped || now.blocked ? 'paused' : 'closed'
  })
  const allowsEditing = computed(() => standing.value === 'editing')
  const editingPaused = computed(() => standing.value === 'paused')
  const saveState = computed(() => (live.value ? (status.value?.saveState ?? 'clean') : null))
  const unsent = computed(() => (live.value ? (status.value?.unsent ?? 0) : 0))
  const paused = computed(() => (live.value ? (status.value?.paused ?? null) : null))
  const banner = computed(() => {
    const now = status.value
    if (!live.value || !now || !(now.blocked || now.saveState === 'failed')) return null
    return bannerFor({
      blocked: now.blocked,
      stopped: now.stopped,
      onDevice: now.onDevice,
      kept: kept.value,
      unsent: now.unsent,
    })
  })
  const openFailure = computed(() => openFailureFor(openReason.value, openStatus.value))

  return {
    mode,
    room,
    live,
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
