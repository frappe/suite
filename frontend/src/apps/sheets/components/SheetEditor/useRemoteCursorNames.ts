// Which remote cursors show their person's name, the way Writer's carets do: a
// name shows while its person moves and for three seconds after, then folds to
// a dot, and hovering the dot brings it back.
//
// The grid takes its mouse input on the <canvas>, so anything over it that takes
// pointer events is a spot of cells that can't be clicked. The dots stay inert;
// the pointer's position decides which one is hovered.

import { computed, onScopeDispose, reactive, shallowRef, watch, type Ref } from 'vue'

import type { RemoteCursor } from '../../collab/presence'

const NAME_SHOWN_MS = 3000
// How far from a dot's centre the pointer counts as on it: the dot's 4px radius and 2px of slack.
const DOT_REACH = 6

/** A cursor as it's drawn; (x, y) is its top-left corner, where the dot sits, in the grid's space. */
export interface DrawnCursor {
  user: string
  label: string | null
  labelPeers: string[]
  x: number
  y: number
}

export function useRemoteCursorNames(
  cursors: Readonly<Ref<ReadonlyMap<string, Pick<RemoteCursor, 'moveKey'>>>>,
  drawn: Readonly<Ref<DrawnCursor[]>>,
) {
  const named = reactive(new Set<string>())
  const lastMoves = new Map<string, string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  function forget(peer: string) {
    clearTimeout(timers.get(peer))
    timers.delete(peer)
    lastMoves.delete(peer)
    named.delete(peer)
  }

  function nameBriefly(peer: string) {
    clearTimeout(timers.get(peer))
    named.add(peer)
    timers.set(
      peer,
      setTimeout(() => {
        timers.delete(peer)
        named.delete(peer)
      }, NAME_SHOWN_MS),
    )
  }

  // Tracks every peer, not only those on this sheet, so someone arriving from another sheet is named.
  watch(
    cursors,
    (now) => {
      for (const peer of [...lastMoves.keys()]) {
        if (!now.has(peer)) forget(peer)
      }
      for (const [peer, { moveKey }] of now) {
        if (lastMoves.get(peer) === moveKey) continue
        lastMoves.set(peer, moveKey)
        nameBriefly(peer)
      }
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    for (const timer of timers.values()) clearTimeout(timer)
  })

  const pointer = shallowRef<{ x: number; y: number } | null>(null)

  // Read from where the dots are now, so one that scrolls away from a still pointer folds.
  const hovered = computed(() => {
    const at = pointer.value
    if (!at) return null
    const dot = drawn.value.find(
      ({ label, x, y }) =>
        label && Math.abs(at.x - x) <= DOT_REACH && Math.abs(at.y - y) <= DOT_REACH,
    )
    return dot?.user ?? null
  })

  /** For the grid wrapper's mousemove: `drawn`'s coordinates are relative to it. */
  function trackPointer(event: MouseEvent) {
    if (!drawn.value.length) return
    if (!(event.currentTarget instanceof Element)) return
    const { left, top } = event.currentTarget.getBoundingClientRect()
    pointer.value = { x: event.clientX - left, y: event.clientY - top }
  }

  function clearPointer() {
    pointer.value = null
  }

  /** Whether this cursor's label is drawn as a dot. A shared label stays named while anyone on it moves. */
  function isFolded(cursor: DrawnCursor) {
    if (!cursor.label || hovered.value === cursor.user) return false
    return !cursor.labelPeers.some((peer) => named.has(peer))
  }

  return { isFolded, trackPointer, clearPointer }
}
