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
 * Lets the route change a guard holds go through as a slide, as a phone pushes a page over the one
 * it came from and pops it off again: the page as it was is pictured, the route changes, and the
 * new page slides in over it (or the old one slides off it). The look is in index.css, by
 * `data-page-slide`. Where the browser has no view transitions, it simply changes.
 */
export const slideRouteChange = (router: Router, direction: PageSlide): Promise<void> => {
  if (!canSlide()) return Promise.resolve()
  return new Promise((proceed) => {
    const root = document.documentElement
    root.dataset.pageSlide = direction
    let pictured = false
    const transition = document.startViewTransition(async () => {
      pictured = true
      // Pictured as it was: let the route change, and wait for the page it leads to.
      const landed = new Promise<void>((done) => {
        const stop = router.afterEach(() => {
          stop()
          done()
        })
      })
      proceed()
      await landed
      await nextTick()
    })
    void transition.finished.finally(() => delete root.dataset.pageSlide)
    // A page the browser is not drawing (a webview out of sight) is never pictured, and the move
    // would wait on it: then it goes without the slide.
    setTimeout(() => !pictured && transition.skipTransition(), 200)
  })
}
