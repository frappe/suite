import { describe, expect, it, vi } from 'vitest'

import type { CalendarRow } from '@/apps/calendar/utils/calendars'

import { useCalendarActions } from './useCalendarActions'

// Nothing here is saved: the menu is worked out from the row alone.
vi.mock('@/api', () => ({ api: {}, client: {} }))
vi.mock('@/apps/calendar/stores/user', () => ({ userStore: () => ({}) }))

const cal = (extra: Partial<CalendarRow> = {}): CalendarRow => ({
  name: 'acc|a',
  account: 'acc',
  id: 'a',
  _name: 'Team',
  default: 0,
  visible: 1,
  may_write_all: 1,
  may_delete: 1,
  ...extra,
})

const offered = (calendar: CalendarRow) =>
  useCalendarActions()
    .menuOptions(calendar)
    .filter((option) => !option.condition || option.condition())
    .map((option) => option.label)

describe('useCalendarActions', () => {
  it('offers a read-only calendar nothing, so the sidebar draws no options button', () => {
    const readOnly = cal({ may_write_all: 0, may_delete: 0 })

    expect(offered(readOnly)).toEqual([])
    expect(useCalendarActions().hasMenuOptions(readOnly)).toBe(false)
  })

  it('offers a calendar of your own its edits', () => {
    expect(offered(cal())).toEqual(['Edit', 'Set as Default', 'Delete'])
  })
})
