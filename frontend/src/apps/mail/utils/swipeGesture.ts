// The geometry behind swipe-to-page, kept apart from its Vue wiring: `useSwipeNav`
// is bound to a router, a store and a theme, and the rule itself is worth being able
// to state — and test — without any of them. The message iframe carries a copy of
// this rule rather than an import (EmailContent builds its script as a string, into
// a sandboxed document); keep the two in step.

/** A swipe must travel at least this far sideways. */
export const SWIPE_MIN_X = 64

// Vertical travel that settles a gesture as a scroll, for good. The path decides that,
// not the two endpoints: a scroll that wanders back towards the height it began at nets
// almost no dy, and a thumb travelling that far arcs well past SWIPE_MIN_X sideways —
// which is how reading a message used to page to the next one. Once a gesture has
// scrolled it can never become a swipe, however it ends.
export const SCROLL_LOCK_Y = 24

/** Left → 1 (next), right → -1 (previous). */
export type SwipeOffset = 1 | -1

export const createSwipeGesture = () => {
	let origin: { x: number; y: number } | null = null
	let scrolling = false

	return {
		/** `touchCount` over one hand back the gesture: a pinch or a two-finger scroll. */
		start(x: number, y: number, touchCount = 1) {
			scrolling = false
			origin = touchCount === 1 ? { x, y } : null
		},

		move(x: number, y: number) {
			if (!origin || scrolling) return
			const dy = y - origin.y
			if (Math.abs(dy) > SCROLL_LOCK_Y && Math.abs(dy) > Math.abs(x - origin.x))
				scrolling = true
		},

		/** The direction to page, or null when the gesture was not a swipe. */
		end(x: number, y: number): SwipeOffset | null {
			if (!origin) return null
			const dx = x - origin.x
			const dy = y - origin.y
			const wasScrolling = scrolling
			origin = null
			scrolling = false

			if (wasScrolling) return null
			if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) < Math.abs(dy) * 2) return null
			return dx < 0 ? 1 : -1
		},

		/** Drops the gesture — nothing it does afterwards can page the thread. */
		cancel() {
			origin = null
			scrolling = false
		},
	}
}
