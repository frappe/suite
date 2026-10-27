import { describe, expect, it } from 'vitest'

import { canonicalRoutes } from '@/composition/routes'

describe('canonical route metadata', () => {
  it('declares a frame and scroll owner on every canonical route', () => {
    for (const route of canonicalRoutes) {
      expect(route.meta?.frame, String(route.path)).toMatch(/^(shell|none)$/)
      expect(route.meta?.scroll, String(route.path)).toMatch(/^(shell|content)$/)
    }
  })

  it.each(['mail', 'calendar', 'people', 'meet'])('renders %s in the shell', (area) => {
    expect(canonicalRoutes.find((route) => route.meta?.area === area)?.meta?.frame).toBe('shell')
  })
})
