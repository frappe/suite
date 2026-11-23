import { onMounted, onUnmounted, ref } from 'vue'

/**
 * What the on-screen keyboard has left of the layout viewport, for holding a full-screen pane
 * clear of it.
 *
 * iOS leaves the layout viewport full-height when the keyboard opens and slides the visible part
 * around underneath it, so `position: fixed; inset: 0` runs on behind the keyboard and has to be
 * held off it by hand: `height` is what is left once the keyboard has taken its share, so a pane
 * ends where the keyboard starts, and `top` is how far iOS has panned to reveal a focused field,
 * so the pane rides that pan instead of being dragged off the top of the screen. `bottom` is how
 * much of the screen the keyboard covers below the pane, for anything that pads itself off the
 * screen's bottom edge and should stop once the keyboard is in the way.
 *
 * `interactive-widget=resizes-content` (index.html) is supposed to make both unnecessary by
 * shrinking the layout viewport itself. It did not, on the iOS this was built against: sizing a
 * pane to the window put its toolbar straight back behind the keyboard. Treat these as load-bearing.
 */
export const useKeyboardInsets = () => {
  const top = ref(0)
  /** The visible height — what's left of the screen once the keyboard has taken its share. */
  const height = ref(window.innerHeight)
  const bottom = ref(0)

  const update = () => {
    const viewport = window.visualViewport
    if (!viewport) return

    height.value = viewport.height
    top.value = viewport.offsetTop
    bottom.value = Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)
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

  return { top, height, bottom }
}

// How many mounted components are holding the document still. The quick reply hands over to the
// compose page on Expand, and the page mounts before the reply unmounts: the hold is let go only
// once neither has it.
let holds = 0

/**
 * Holds the document still for as long as the calling component is mounted, so the keyboard does
 * not scroll the page up underneath what is on screen.
 *
 * iOS opens the keyboard over a focused field by scrolling the document itself: `window.scrollY`
 * goes non-zero, and `visualViewport.offsetTop` (the `top` above) reports the same number. A pane
 * that rides `top` is pushed down by as much as the page went up, and whatever does not ride it,
 * such as a thread behind a reply field, goes up off the top of the screen. A document that cannot
 * scroll has neither.
 *
 * `position: fixed` as well as `overflow: hidden`, because overflow alone still leaves iOS a
 * document to scroll for a focused field.
 */
export const useStillDocument = () => {
  onMounted(() => {
    if (holds++) return
    Object.assign(document.body.style, { overflow: 'hidden', position: 'fixed', width: '100%' })
    document.documentElement.style.overflow = 'hidden'
  })
  onUnmounted(() => {
    if (--holds) return
    Object.assign(document.body.style, { overflow: '', position: '', width: '' })
    document.documentElement.style.overflow = ''
  })
}
