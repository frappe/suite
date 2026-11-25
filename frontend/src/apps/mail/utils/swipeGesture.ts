// The geometry behind swipe-to-page, kept apart from its Vue wiring: `useThreadSwipe` binds it to
// touches and to the view, and the rule itself is worth being able to state, and test, without
// them. The message iframe carries a copy of `LOCK_AT` (EmailContent builds its script as a string,
// into a sandboxed document); keep the two in step.

/** Travel that settles what a gesture is: a sideways drag of the page, or a scroll, for good. */
export const LOCK_AT = 10

/** A page let go past this share of its width goes on to the next. */
const COMMIT_SHARE = 0.3
/** Or let go this fast (px per ms), flung its way, however far it went. */
const FLING_SPEED = 0.4
/** The speed is read over the last stretch of the drag, not the whole of it. */
const SPEED_WINDOW = 80

/** Left → 1 (next), right → -1 (previous). */
export type SwipeOffset = 1 | -1

export type SwipePhase = 'pending' | 'drag' | 'scroll'

/** What a gesture is so far, and how far it has dragged the page. */
export interface SwipeMove {
  phase: SwipePhase
  dx: number
}

interface Point {
  x: number
  y: number
  t: number
}

export const createSwipeGesture = () => {
  let origin: Point | null = null
  let phase: SwipePhase = 'pending'
  // Recent points, for the speed at the moment of letting go.
  let trail: Point[] = []

  return {
    /** `touchCount` over one hands the gesture back: a pinch or a two-finger scroll. */
    start(x: number, y: number, t: number, touchCount = 1) {
      phase = 'pending'
      origin = touchCount === 1 ? { x, y, t } : null
      trail = origin ? [origin] : []
    },

    /**
     * What the gesture is so far, and how far it has dragged the page. The first `LOCK_AT` pixels
     * decide: mostly sideways is a drag, anything else a scroll, and neither turns into the other.
     */
    move(x: number, y: number, t: number): SwipeMove {
      if (!origin) return { phase: 'scroll', dx: 0 }
      const dx = x - origin.x
      const dy = y - origin.y
      if (phase === 'pending' && Math.hypot(dx, dy) >= LOCK_AT)
        phase = Math.abs(dx) > Math.abs(dy) ? 'drag' : 'scroll'
      trail.push({ x, y, t })
      while (trail.length > 2 && t - trail[0]!.t > SPEED_WINDOW) trail.shift()
      return { phase, dx: phase === 'drag' ? dx : 0 }
    },

    /** Where a drag let go leads: the direction to page, or null to settle back. */
    end(x: number, t: number, width: number): SwipeOffset | null {
      const from = trail[0]
      const dragged = phase === 'drag' && origin ? x - origin.x : 0
      origin = null
      phase = 'pending'
      trail = []
      if (!dragged) return null

      const speed = from && t > from.t ? (x - from.x) / (t - from.t) : 0
      const fast = Math.abs(speed) >= FLING_SPEED
      // Thrown back the way it came, the page goes back, however far it was taken
      if (fast && Math.sign(speed) !== Math.sign(dragged)) return null
      if (!fast && Math.abs(dragged) < width * COMMIT_SHARE) return null
      return dragged < 0 ? 1 : -1
    },

    /** Drops the gesture: nothing it does afterwards can page the thread. */
    cancel() {
      origin = null
      phase = 'pending'
      trail = []
    },
  }
}
