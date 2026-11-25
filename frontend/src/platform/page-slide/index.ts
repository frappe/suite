import { nextTick } from 'vue'
import type { Router } from 'vue-router'

/** Which way a phone's page moves: in from the right, or back out to it. */
export type PageSlide = 'forward' | 'back'

// When a phone's own back swipe (iOS Safari's edge swipe) has already drawn the page going, a slide
// of ours would draw it a second time. The browser says so on the popstate it sends for that swipe.
let swipedBackAt = 0
if (typeof window !== 'undefined')
  window.addEventListener('popstate', (event) => {
    if ('hasUAVisualTransition' in event && event.hasUAVisualTransition)
      swipedBackAt = performance.now()
  })

const canSlide = () =>
  typeof document !== 'undefined' &&
  'startViewTransition' in document &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
  performance.now() - swipedBackAt > 500

/**
 * Makes a change go through as a slide, as a phone pushes a page over the one it came from and pops
 * it off again: the screen as it was is pictured, `change` runs, and once it has settled the new
 * screen slides in over the old (or the old slides off it). The look is in index.css, by
 * `data-page-slide`. Where the browser has no view transitions, the change simply happens.
 */
export const slideChange = (
  direction: PageSlide,
  change: () => void | Promise<void>,
): Promise<void> => {
  if (!canSlide()) return Promise.resolve(change())
  const root = document.documentElement
  root.dataset.pageSlide = direction
  let pictured = false
  const transition = document.startViewTransition(async () => {
    pictured = true
    await change()
    await nextTick()
  })
  void transition.finished.finally(() => delete root.dataset.pageSlide)
  // A page the browser is not drawing (a webview out of sight) is never pictured, and the change
  // would wait on it: then it goes without the slide.
  setTimeout(() => !pictured && transition.skipTransition(), 200)
  return transition.updateCallbackDone
}

/**
 * Lets the route change a guard holds go through as a slide (see `slideChange`): the guard's
 * promise settles as the change is let through, and the slide waits for the page it leads to.
 */
export const slideRouteChange = (router: Router, direction: PageSlide): Promise<void> =>
  new Promise((proceed) => {
    void slideChange(direction, async () => {
      const landed = new Promise<void>((done) => {
        const stop = router.afterEach(() => {
          stop()
          done()
        })
      })
      proceed()
      await landed
    })
  })
