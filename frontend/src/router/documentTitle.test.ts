import { beforeEach, describe, expect, it } from 'vitest'
import type { RouteLocationNormalizedLoaded } from 'vue-router'

import { setDocumentTitle } from './index'

const HOME = { name: 'slides-home' }
const EDITOR = { name: 'slides-editor' }

const at = (record: object, title = 'Frappe Slides') =>
  ({
    matched: [{ name: 'slides-group' }, record],
    meta: { title },
  }) as RouteLocationNormalizedLoaded

describe('setDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Presentation - Frappe Slides'
  })

  it('leaves the title alone on a same-view navigation', () => {
    setDocumentTitle(at(EDITOR), at(EDITOR))
    expect(document.title).toBe('Presentation - Frappe Slides')
  })

  it('applies the app title when the view changes', () => {
    setDocumentTitle(at(HOME), at(EDITOR))
    expect(document.title).toBe('Frappe Slides')
  })

  it('leaves the title alone when the route carries none', () => {
    setDocumentTitle(at(HOME, ''), at(EDITOR))
    expect(document.title).toBe('Presentation - Frappe Slides')
  })
})
