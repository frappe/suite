import { toast } from 'frappe-ui'
import { computed, nextTick, shallowRef, watch } from 'vue'

import { slidesAdapter } from '@/apps/slides/collab/adapter'
import { elementText } from '@/apps/slides/collab/deck'
import { drawnSlides } from '@/apps/slides/collab/drawnDeck'
import {
  openLiveDeck,
  type LiveDeck,
  type LiveStep,
  type StoreItem,
  type StoreSlide,
} from '@/apps/slides/collab/liveDeck'
import { sharedPresence } from '@/apps/slides/collab/livePresence'
import { liveTextExtensions } from '@/apps/slides/collab/liveText'
import { lastSelector, usePeopleSelecting } from '@/apps/slides/collab/peerOutlines'
import { activeElementIds, focusElementId, resetFocus } from '@/apps/slides/stores/element'
import { jumpToElementsByIds, jumpToSlideByIndex } from '@/apps/slides/stores/historyMeta'
import {
  boundElementId,
  currentId,
  isTextEditedHere,
  rememberRenames,
  setBoundText,
  setLiveSeat,
} from '@/apps/slides/stores/liveDeck'
import {
  flattenNow,
  measureNow,
  slidesLength,
  transformElements,
} from '@/apps/slides/stores/presentation'
import { setSlideIndex, slideIndex, slides } from '@/apps/slides/stores/slide'
import {
  isRecoverable,
  openCollabRoom,
  type CollabRoom,
  type CollabSession,
  type RoomPresence,
  type RoomStatus,
} from '@/platform/collab'
import { translate } from '@/platform/translation'

interface RoomHost {
  session: CollabSession
  /** Whether this tab may change the presentation, the room aside. */
  mayEdit: () => boolean
  /** Keeps the slides in this browser when the room stops holding unsent work. */
  retainRecovery: () => boolean
  /** Keeps the slides in this browser past any later save. */
  retainSticky: () => boolean
}

function allowsEditingIn(status: RoomStatus) {
  const hasLostAccess = status.blockReason === 'lost_edit' || status.blockReason === 'lost_read'
  const hasStopped = status.saveState === 'failed' || status.blockReason === 'offline'
  return status.canWrite && !hasLostAccess && !hasStopped
}

function isKeptNowhere(status: RoomStatus, isRecoveryKept: boolean) {
  return (
    status.unsentCount > 0 && (!status.isKeptOnDevice || status.hasCopyFailed) && !isRecoveryKept
  )
}

// A converted presentation's live room: open, mirrored into the slide store, closed
export function useConvertedRoom({ session, mayEdit, retainRecovery, retainSticky }: RoomHost) {
  const room = shallowRef<CollabRoom | null>(null)
  const status = shallowRef<RoomStatus | null>(null)
  const presence = shallowRef<RoomPresence | null>(null)
  const selectorOf = lastSelector(usePeopleSelecting(presence))
  let deck: LiveDeck | null = null
  let stopWatching = () => {}
  let isRecoveryKept = false
  let isClosed = false

  const allowsEditing = computed(() => !!status.value && allowsEditingIn(status.value))
  const saveState = computed(() => status.value?.saveState ?? 'clean')

  const sizes = new Map<string, { key: string; size: { width: number; height: number } }>()
  function measured(element: StoreItem) {
    const key = `${element.width}|${element.lineHeight}|${element.content}`
    const known = sizes.get(element.id)
    if (known?.key === key) {
      return known.size
    }

    const size = measureNow(element)
    sizes.set(element.id, { key, size })
    return size
  }

  function canWrite() {
    return mayEdit() && allowsEditing.value
  }

  function keepShownSlide(previousIds: string[]) {
    const total = slides.value.length
    slidesLength.value = total
    if (total) {
      const at = slideIndex.value ?? 0
      const kept = slides.value.findIndex(({ clientId }) => clientId === previousIds[at])
      const next = kept === -1 ? Math.min(at, total - 1) : kept
      if (next !== at) {
        setSlideIndex(next + 1)
      }
    }

    const present = new Set(slides.value.flatMap(({ elements }) => elements).map(({ id }) => id))
    if (activeElementIds.value.some((id: string) => !present.has(id))) {
      activeElementIds.value = activeElementIds.value.filter((id: string) => present.has(id))
    }

    if (focusElementId.value && !present.has(focusElementId.value)) {
      focusElementId.value = null
    }
  }

  function applyRenames(renames: Map<string, string>) {
    rememberRenames(renames)
    activeElementIds.value = activeElementIds.value.map((id: string) => renames.get(id) ?? id)
    if (focusElementId.value) {
      focusElementId.value = renames.get(focusElementId.value) ?? focusElementId.value
    }
  }

  function showStep({ direction, isBlocked, slideId, elementIds }: LiveStep) {
    if (isBlocked) {
      toast.warning(
        direction === 'undo'
          ? translate("Couldn't undo: a co-editor changed this")
          : translate("Couldn't redo: a co-editor changed this"),
      )
    }

    const index = slides.value.findIndex(({ clientId }) => clientId === slideId)
    if (index !== -1) {
      jumpToSlideByIndex(index, true)
    }

    jumpToElementsByIds(elementIds)
  }

  function keepDeletedText(id: string) {
    if (!isTextEditedHere()) {
      return
    }

    if (!retainSticky()) {
      toast.error(translate('Your latest changes could not be kept on this device.'))
      return
    }

    const name = selectorOf(id)
    toast.warning(
      name
        ? translate('{0} deleted this element. Your text is in a recovery copy.', [name])
        : translate('A co-editor deleted this element. Your text is in a recovery copy.'),
    )
  }

  function seat(liveRoom: CollabRoom) {
    const { doc } = liveRoom
    const shared = sharedPresence(liveRoom.presence)
    // SAFETY: the slide store holds what `drawnSlides` and the editor put there, each with a clientId and elements
    const storeSlides = () => slides.value as StoreSlide[]
    deck = openLiveDeck(doc, {
      slides: storeSlides,
      flatten: (element) => flattenNow(element, measured),
      boundElementId,
      setBoundText,
      canWrite,
      onRenamed: applyRenames,
      onMerged: keepShownSlide,
      onStep: showStep,
      onBoundDeleted: keepDeletedText,
    })
    const liveDeck = deck
    setLiveSeat({
      push: () => liveDeck.push(),
      flush: () => {
        liveDeck.push()
        void liveRoom.flush()
      },
      undo: () => liveDeck.undo(),
      redo: () => liveDeck.redo(),
      endStep: () => liveDeck.endStep(),
      bindText(id, seedHtml) {
        const isEmpty = !elementText(doc, id)?.length
        const seeded = isEmpty && !!seedHtml && canWrite()
        if (seeded) {
          liveDeck.seedText(id, seedHtml)
        }

        const fragment = elementText(doc, id)
        if (!fragment) {
          return { extensions: [], seeded: false }
        }

        return {
          extensions: liveTextExtensions(fragment, shared.textPresence, liveDeck.undoManager),
          seeded,
        }
      },
    })
    presence.value = liveRoom.presence
    const stopSelection = watch(
      activeElementIds,
      (ids: string[]) => {
        if (canWrite()) {
          shared.publishSelection(ids.map(currentId))
        }
      },
      { immediate: true },
    )
    return () => {
      stopSelection()
      liveDeck.stop()
      setLiveSeat(null)
      presence.value = null
      deck = null
    }
  }

  // Mirrors the room's state, or rebuilds the room once it asks for that
  function syncStatus(liveRoom: CollabRoom) {
    const liveStatus = liveRoom.status
    if (liveStatus.isReopenNeeded) {
      if (isKeptNowhere(liveStatus, isRecoveryKept)) {
        isRecoveryKept = retainRecovery()
      }

      // Unsent work held nowhere else stays on screen in the old room until it is sent
      if (!isKeptNowhere(liveStatus, isRecoveryKept)) {
        void rebuild(liveRoom)
        return
      }
    }

    const { blockReason } = liveStatus
    const hasStopped =
      liveStatus.saveState === 'failed' || (blockReason && !isRecoverable(blockReason))
    if (hasStopped && liveStatus.unsentCount && !isRecoveryKept) {
      isRecoveryKept = retainRecovery()
    }

    status.value = liveStatus
  }

  async function openRoom(isStale: () => boolean) {
    const opened = await openCollabRoom({ session, adapter: slidesAdapter })
    if (opened.state !== 'live') {
      return false
    }

    const liveRoom = opened.room
    // once, so the fonts have loaded before anything is measured without waiting
    await transformElements(drawnSlides(liveRoom.doc).flatMap(({ elements }) => elements))
    if (isClosed || isStale()) {
      void liveRoom.close()
      return true
    }

    room.value = liveRoom
    isRecoveryKept = false
    status.value = liveRoom.status
    const leaveSeat = seat(liveRoom)
    const stopStatus = liveRoom.onChange(() => syncStatus(liveRoom))
    stopWatching = () => {
      stopStatus()
      leaveSeat()
    }
    syncStatus(liveRoom)
    return true
  }

  // The editor goes before the old room, so nothing typed lands in a room that no longer sends
  function leave() {
    resetFocus()
    deck?.push()
    stopWatching()
    stopWatching = () => {}
    const old = room.value
    room.value = null
    status.value = null
    return old
  }

  async function rebuild(oldRoom: CollabRoom) {
    if (room.value !== oldRoom) return

    leave()
    await nextTick()
    await oldRoom.close()
    if (!isClosed) {
      await openRoom(() => false)
    }
  }

  /** Answers false when the room won't open. A stale open closes what it opened. */
  async function open(isStale: () => boolean) {
    void leave()?.close()
    slides.value = []
    return openRoom(isStale)
  }

  function close() {
    isClosed = true
    void leave()?.close()
  }

  return { allowsEditing, saveState, presence, open, close }
}
