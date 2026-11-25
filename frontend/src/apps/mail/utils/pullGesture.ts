// The geometry behind pull to refresh, kept apart from its Vue wiring: `usePullToRefresh` binds it
// to touches and to the list, and the rule itself is worth being able to state, and test, without
// them.

/** Travel that settles what a gesture is: a pull, or anything else, for good. */
export const DECIDE_AT = 10

/** A pull let go this far down (the spinner's offset, not the finger's) refreshes the list. */
export const REFRESH_AT = 64

/** The furthest the spinner goes, however far the finger does. */
const MAX_OFFSET = 128
/** How much of the finger's first travel the spinner follows; less, and less, after that. */
const FOLLOW = 0.6

/**
 * Where the spinner sits for a finger `dy` pixels down from where it started: a rubber band, which
 * follows the finger at first and gives less the further it is stretched, up to `MAX_OFFSET`.
 */
export const pullOffset = (dy: number) =>
  dy <= 0 ? 0 : MAX_OFFSET * (1 - Math.exp((-dy * FOLLOW) / MAX_OFFSET))

export type PullPhase = 'pending' | 'pull' | 'other'

/** What a gesture is so far, and where it holds the spinner. */
export interface PullMove {
  phase: PullPhase
  offset: number
}

export const createPullGesture = () => {
  let origin: { x: number; y: number } | null = null
  let phase: PullPhase = 'pending'
  let offset = 0
  const reset = () => {
    origin = null
    phase = 'pending'
    offset = 0
  }

  return {
    /**
     * Only a gesture that starts with the list at its top can pull, and only with one finger: on
     * a list scrolled down it scrolls, even once the list is back at its top.
     */
    start(x: number, y: number, scrollTop: number, touchCount = 1) {
      phase = 'pending'
      offset = 0
      origin = touchCount === 1 && scrollTop <= 0 ? { x, y } : null
    },

    /**
     * The first `DECIDE_AT` pixels decide: mostly downward is a pull, anything else (a scroll up
     * the list, a sideways swipe) is not, and neither turns into the other. Till then the spinner
     * follows a finger heading mostly down, so it doesn't jump in once the pull is settled.
     */
    move(x: number, y: number): PullMove {
      if (!origin) return { phase: 'other', offset: 0 }
      const dx = x - origin.x
      const dy = y - origin.y
      const downward = dy > Math.abs(dx)
      if (phase === 'pending' && Math.hypot(dx, dy) >= DECIDE_AT)
        phase = downward ? 'pull' : 'other'
      offset = phase === 'pull' || (phase === 'pending' && downward) ? pullOffset(dy) : 0
      return { phase, offset }
    },

    /** Whether the gesture let go refreshes: a pull taken past `REFRESH_AT`. */
    end(): boolean {
      const refresh = phase === 'pull' && offset >= REFRESH_AT
      reset()
      return refresh
    },

    /** Drops the gesture: nothing it does afterwards can refresh. */
    cancel: reset,
  }
}
