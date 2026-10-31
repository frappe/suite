import { describe, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { canonicalRoutes } from '@/composition/routes'

describe('canonical route metadata', () => {
  it('declares a frame and scroll owner on every canonical route', () => {
    for (const route of canonicalRoutes) {
      expect(route.meta?.frame, String(route.path)).toMatch(/^(shell|none)$/)
      expect(route.meta?.scroll, String(route.path)).toMatch(/^(shell|content)$/)
    }
  })

  it('names the recovery copies page before its routes load', () => {
    const recovery = canonicalRoutes.find((route) => route.path === '/drive/recovery')
    expect(recovery?.meta?.title).toBe('Recovery copies')
  })

  it.each(['mail', 'calendar', 'people', 'meet'])('renders %s in the shell', (area) => {
    expect(canonicalRoutes.find((route) => route.meta?.area === area)?.meta?.frame).toBe('shell')
  })
})

describe('document routes', () => {
  const router = createRouter({ history: createMemoryHistory(), routes: canonicalRoutes })

  it('opens the slideshow at /present and the document at any other slug', () => {
    expect(router.resolve('/d/n1/present').name).toBe('slides-slideshow')
    expect(router.resolve('/d/n1/q3-review').name).toBe('document-host')
    expect(router.resolve('/d/n1').name).toBe('document-host')
  })

  it('admits guests to a slideshow', () => {
    expect(router.resolve('/d/n1/present').meta.allowGuest).toBe(true)
  })
})
