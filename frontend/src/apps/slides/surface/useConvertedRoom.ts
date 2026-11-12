import { toast } from 'frappe-ui'
import { computed, nextTick, shallowRef, watch, type Ref } from 'vue'

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
import { resetGrowthBaseline } from '@/apps/slides/composables/useTextEditor'
import {
  resetFocus,
  activeElementIds as storeActiveIds,
  focusElementId as storeFocusId,
} from '@/apps/slides/stores/element'
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
import { currentSlide, setSlideIndex, slideIndex, slides } from '@/apps/slides/stores/slide'
import { holdShownSlide } from '@/apps/slides/stores/slideshow'
import {
  isRecoverable,
  openCollabRoom,
  type CollabRoom,
  type CollabSession,
  type LostAccess,
  type RoomPresence,
  type RoomStatus,
  type VersionRestored,
} from '@/platform/collab'
import type { RestoreNotice } from '@/platform/collab/restoreNotices'
import { translate } from '@/platform/translation'

import { restoreVersion } from './restoreVersion'
import { saveFirst } from './saveFirst'
import type { RetainOptions } from './useUnsavedRecovery'
import type { ConvertedVersion } from './versions'

// SAFETY: the untyped element store holds the selected element ids
const activeElementIds = storeActiveIds as Ref<string[]>
// SAFETY: the untyped element store holds the id of the element being typed in, or null
const focusElementId = storeFocusId as Ref<string | null>
// SAFETY: the slide store holds what `drawnSlides` and the editor put there, each with a clientId and elements
const storeSlides = () => slides.value as StoreSlide[]

interface RoomHost {
  session: CollabSession
  /** Whether this tab may change the presentation, the room aside. */
  mayEdit: () => boolean
  /** Whether the slideshow route is open, from before its slides have loaded. */
  isPresenting: () => boolean
  /** Keeps the slides in this browser when the room stops holding unsent work. */
  retainRecovery: (options?: RetainOptions) => boolean
  /** Keeps the slides in this browser past any later save, or offers them as a download. */
  retainStickyOrOffer: () => boolean
  /** Told once the room's slides are first drawn, before any copy of them is kept. */
  settleCopies: () => void
  /** Told when the presentation's comment threads may have changed. */
  onThreadsChanged: () => void
  /** Told when another tab's restore lands. */
  onVersionRestored: (restored: VersionRestored) => void
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
export function useConvertedRoom({
  session,
  mayEdit,
  isPresenting,
  retainRecovery,
  retainStickyOrOffer,
  settleCopies,
  onThreadsChanged,
  onVersionRestored,
}: RoomHost) {
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
  let isFontPending = false

  // Until the font comes, edits leave the saved centre alone: nothing waits, a save included
  function redrawWhenFontsLoad() {
    if (isFontPending) {
      return
    }

    isFontPending = true
    void document.fonts.ready.then(() => {
      deck?.push()
      isFontPending = false
      deck?.redraw()
      void resetGrowthBaseline()
    })
  }

  function measured(element: StoreItem) {
    const key = `${element.width}|${element.lineHeight}|${element.content}`
    const known = sizes.get(element.id)
    if (known?.key === key) {
      return known.size
    }

    const size = measureNow(element)
    if (document.fonts.status === 'loading') {
      redrawWhenFontsLoad()
      return size
    }

    sizes.set(element.id, { key, size })
    return size
  }

  // the show writes nothing, a repair of an emptied presentation included (Q175, Q178′)
  function canWrite() {
    return mayEdit() && allowsEditing.value && !isPresenting()
  }

  function keepShownSlide(previous: StoreSlide[]) {
    const total = slides.value.length
    slidesLength.value = total
    if (total) {
      const at = slideIndex.value ?? 0
      const shown = previous[at]
      const kept = slides.value.findIndex(({ clientId }) => clientId === shown?.clientId)
      // Q175: the show keeps a deleted shown slide up, and its end screen stays a place to be
      if (kept === -1 && shown && isPresenting()) {
        holdShownSlide(shown)
      }

      const last = isPresenting() ? total : total - 1
      const next = kept === -1 ? Math.min(at, last) : kept
      if (next !== at) {
        setSlideIndex(next + 1)
      }
    }

    const present = new Set(
      storeSlides()
        .flatMap(({ elements }) => elements)
        .map(({ id }) => id),
    )
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

    if (!retainStickyOrOffer()) {
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
    // a room opened with the realtime socket, as `openCollabRoom` always does, has presence
    const shared = sharedPresence(liveRoom.presence!)
    deck = openLiveDeck(doc, {
      slides: storeSlides,
      flatten: (element) => flattenNow(element, measured),
      boundElementId,
      isSelected: (id) =>
        activeElementIds.value.includes(id) || currentSlide.value?.clientId === id,
      setBoundText,
      canWrite,
      restoreRev: () => liveRoom.status.restoreRev,
      fontsPending: () => isFontPending || document.fonts.status === 'loading',
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
      holdsPosition: liveDeck.holdsPosition,
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
    const stopRestores = liveRoom.onChange(() => liveDeck.followRestore())
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
      stopRestores()
      stopSelection()
      liveDeck.stop()
      setLiveSeat(null)
      presence.value = null
      deck = null
    }
  }

  // the room is given up for this copy, so no later copy replaces it, whatever the access is by then
  function retainStopped() {
    return retainRecovery({ sticky: true })
  }

  // Mirrors the room's state, or rebuilds the room once it asks for that
  function syncStatus(liveRoom: CollabRoom) {
    const liveStatus = liveRoom.status
    if (liveStatus.isReopenNeeded) {
      if (isKeptNowhere(liveStatus, isRecoveryKept)) {
        isRecoveryKept = retainStopped()
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
      isRecoveryKept = retainStopped()
    }

    status.value = liveStatus
  }

  async function openRoom(isStale: () => boolean) {
    const opened = await openCollabRoom({
      session,
      adapter: slidesAdapter,
      onThreadsChanged,
      onVersionRestored,
    })
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
    settleCopies()
    const stopStatus = liveRoom.onChange(() => syncStatus(liveRoom))
    stopWatching = () => {
      stopStatus()
      leaveSeat()
    }
    syncStatus(liveRoom)
    return true
  }

  // A named version holds only saved edits; it throws why they couldn't be
  async function saveBeforeVersion() {
    if (room.value) {
      await saveFirst(room.value)
    }
  }

  /** Shuts the room for a lost right; what it can't send within the bound stays a recovery copy. True if work is left unsent. */
  async function loseAccess(lost: LostAccess) {
    try {
      await room.value?.loseAccess(lost)
    } catch (error) {
      console.error(error)
    }

    return !!room.value?.status.unsentCount
  }

  /**
   * Opens the room to edits again once access comes back. `reload` when the room stays shut: a new
   * open takes edits. `held` when that open would drop unsent work kept nowhere else.
   */
  async function regainAccess() {
    const liveRoom = room.value
    if (!liveRoom) {
      return 'reload'
    }

    await liveRoom.regainAccess(mayEdit)
    if (allowsEditing.value) {
      return 'editing'
    }

    return isKeptNowhere(liveRoom.status, isRecoveryKept) ? 'held' : 'reload'
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

  /** Restores version `seq` from its stored bytes, once this tab's edits are sent (Q5); `convert` upgrades an old one. */
  async function restore(
    seq: number,
    bytes: Uint8Array,
    convert: () => Promise<ConvertedVersion>,
  ): Promise<RestoreNotice> {
    const liveRoom = room.value
    const liveDeck = deck
    if (!liveRoom || !liveDeck) {
      return { isRestored: false, message: translate('The version was not restored.') }
    }

    liveDeck.push()
    // Nothing this tab did or held before the restore may come back over it
    return restoreVersion(liveRoom, seq, bytes, liveDeck.forgetSteps, convert)
  }

  /** Puts the layout on a new presentation's one blank slide. False if it isn't blank any more. */
  function fillBlank(layout: StoreSlide) {
    return deck?.fillBlank(layout) ?? false
  }

  return {
    allowsEditing,
    saveState,
    presence,
    open,
    close,
    restore,
    fillBlank,
    saveBeforeVersion,
    loseAccess,
    regainAccess,
  }
}
