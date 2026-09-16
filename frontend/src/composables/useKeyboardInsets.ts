import { onMounted, onUnmounted, ref } from 'vue'

/**
 * What the on-screen keyboard has left of the layout viewport, for holding a full-screen pane
 * clear of it.
 *
 * iOS leaves the layout viewport full-height when the keyboard opens and slides the visible part
 * around underneath it, so `position: fixed; inset: 0` runs on behind the keyboard and has to be
 * held off it by hand: `height` is what is left once the keyboard has taken its share, so a pane
 * ends where the keyboard starts, and `top` is how far iOS has panned to reveal a focused field,
 * so the pane rides that pan instead of being dragged off the top of the screen.
 *
 * `interactive-widget=resizes-content` (index.html) is supposed to make both unnecessary by
 * shrinking the layout viewport itself. It did not, on the iOS this was built against: sizing a
 * pane to the window put its toolbar straight back behind the keyboard. Treat these as load-bearing.
 */
export const useKeyboardInsets = () => {
	const top = ref(0)
	/** The visible height — what's left of the screen once the keyboard has taken its share. */
	const height = ref(window.innerHeight)

	const update = () => {
		const viewport = window.visualViewport
		if (!viewport) return

		height.value = viewport.height
		top.value = viewport.offsetTop
	}

	onMounted(() => {
		update()
		// `resize` is the keyboard opening and closing; `scroll` is iOS panning what's left of the
		// viewport. Missing the second is what lets a pane drift off the top of the screen.
		window.visualViewport?.addEventListener('resize', update)
		window.visualViewport?.addEventListener('scroll', update)
		window.addEventListener('resize', update)
	})

	onUnmounted(() => {
		window.visualViewport?.removeEventListener('resize', update)
		window.visualViewport?.removeEventListener('scroll', update)
		window.removeEventListener('resize', update)
	})

	return { top, height }
}
