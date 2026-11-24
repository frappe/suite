import { onMounted, onUnmounted, readonly, ref } from 'vue'

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

// Input types that raise no on-screen keyboard: focusing one is not the keyboard coming up.
// `shouldIgnoreKeypress` draws the same line for checkboxes.
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])
const isEditable = (el: Element | null) => {
  if (!el) return false
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type)
  return el.tagName === 'TEXTAREA' || (el instanceof HTMLElement && el.isContentEditable)
}

// How far the visible screen has to come short of its full height to be a keyboard: more than a
// browser toolbar folding away, or iOS's slim bar over a hardware keyboard, and less than any
// phone's keyboard.
const KEYBOARD_MIN_HEIGHT = 150
/**
 * Whether an on-screen keyboard is up: a field that types is focused, and the screen has given a
 * keyboard's height to it.
 *
 * The focus alone says too much. A hardware keyboard (an iPad's, or the Simulator's) raises
 * none, and Android's Back puts the keyboard away and leaves the field focused. The screen alone
 * says too little: iOS keeps the window its full height under the keyboard and shrinks only the
 * visible part, while under `interactive-widget=resizes-content` (index.html) Android shrinks the
 * window itself, so the visible height is measured against the tallest it has been at this width.
 * A change of width is a turn of the phone, and the measure starts again.
 *
 * It answers once the keyboard has taken the screen, not on the focus: what steps aside for a
 * keyboard does not go and come back for a field that raises none. iOS's keyboard rises over
 * what is at the bottom anyway, and Android's moves it and is answered in the same frame.
 *
 * `sync` reads the focus again, for a field torn down with its route, which fires no focusout.
 */
export const watchOnScreenKeyboard = () => {
  const up = ref(false)
  const visibleHeight = () => window.visualViewport?.height ?? window.innerHeight
  let width = window.innerWidth
  let fullHeight = Math.max(window.innerHeight, visibleHeight())

  const screenTaken = () => {
    const height = visibleHeight()
    if (window.innerWidth !== width) {
      width = window.innerWidth
      fullHeight = Math.max(window.innerHeight, height)
    }
    fullHeight = Math.max(fullHeight, height)
    return fullHeight - height >= KEYBOARD_MIN_HEIGHT
  }
  const sync = () => {
    up.value = isEditable(document.activeElement) && screenTaken()
  }
  // On the next frame rather than on the event: moving between two fields fires focusout before
  // focusin, and acting on the focusout would let go of the keyboard in between them.
  const syncSoon = () => requestAnimationFrame(sync)

  document.addEventListener('focusin', syncSoon)
  document.addEventListener('focusout', syncSoon)
  window.visualViewport?.addEventListener('resize', sync)
  window.addEventListener('resize', sync)
  const stop = () => {
    document.removeEventListener('focusin', syncSoon)
    document.removeEventListener('focusout', syncSoon)
    window.visualViewport?.removeEventListener('resize', sync)
    window.removeEventListener('resize', sync)
  }
  return { up: readonly(up), sync, stop }
}
