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

/** Two records rendering one component, the way the calendar's four views do. */
const CalendarView = { name: 'CalendarView' }
const MONTH = { name: 'calendar-month', components: { default: CalendarView } }
const AGENDA = { name: 'calendar-agenda', components: { default: CalendarView } }

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

  // Switching the calendar's view is a navigation between four route records
  // that all render CalendarView. The component stays mounted, so its
  // usePageMeta never runs again — reset the title here and the tab reads
  // "Frappe Calendar" for the rest of the session.
  it('leaves the title alone between routes rendering the same view', () => {
    setDocumentTitle(at(AGENDA), at(MONTH))
    expect(document.title).toBe('Presentation - Frappe Slides')
  })

  it('leaves the title alone when the route carries none', () => {
    setDocumentTitle(at(HOME, ''), at(EDITOR))
    expect(document.title).toBe('Presentation - Frappe Slides')
  })
})
