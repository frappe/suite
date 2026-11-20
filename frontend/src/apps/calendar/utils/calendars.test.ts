import { describe, expect, it } from 'vitest'

import {
  calendarColor,
  canEditEvent,
  carriedVisibility,
  defaultCalendar,
  destinationOptions,
  onShownCalendar,
  type CalendarRow,
} from '@/apps/calendar/utils/calendars'

const cal = (name: string, extra: Partial<CalendarRow> = {}): CalendarRow => ({
  name: `acc|${name}`,
  account: 'acc',
  id: name,
  _name: name,
  default: 0,
  visible: 1,
  may_write_all: 1,
  may_delete: 1,
  ...extra,
})

describe('calendarColor', () => {
  it('uses the colour the calendar carries', () => {
    expect(calendarColor([cal('a'), cal('b', { color: '#336699' })], 'acc|b')).toBe('#336699')
  })

  it('assigns a palette colour by position when the calendar has none', () => {
    const calendars = [cal('a'), cal('b', { color: null })]
    expect(calendarColor(calendars, 'acc|a')).toBe('green')
    expect(calendarColor(calendars, 'acc|b')).toBe('blue')
  })
})

describe('defaultCalendar', () => {
  it('is the one flagged default', () => {
    expect(defaultCalendar([cal('a'), cal('b', { default: 1 })])?.id).toBe('b')
  })

  it('falls back to the first, and to nothing before the list loads', () => {
    expect(defaultCalendar([cal('a'), cal('b')])?.id).toBe('a')
    expect(defaultCalendar(undefined)).toBeUndefined()
  })

  it('passes over a calendar the account cannot write to', () => {
    const shared = cal('shared', { default: 1, may_write_all: 0 })
    expect(defaultCalendar([shared, cal('b')])?.id).toBe('b')
    expect(defaultCalendar([shared])).toBeUndefined()
  })
})

describe('destinationOptions', () => {
  const options = [
    { value: 'a', writable: true },
    { value: 'shared', writable: false },
  ]

  it('offers only the calendars that can be written to', () => {
    expect(destinationOptions(options).map((o) => o.value)).toEqual(['a'])
  })

  it('keeps the read-only calendar an event is already on', () => {
    expect(destinationOptions(options, 'shared').map((o) => o.value)).toEqual(['a', 'shared'])
  })
})

describe('canEditEvent', () => {
  const calendars = [cal('mine'), cal('shared', { may_write_all: 0 })]
  const on = (...names: string[]) => ({
    calendars: names.map((name) => ({ calendar: `acc|${name}` })),
  })

  it('is false on a calendar shared read-only', () => {
    expect(canEditEvent(on('shared'), calendars)).toBe(false)
  })

  it('is true when any of its calendars can be written to', () => {
    expect(canEditEvent(on('mine'), calendars)).toBe(true)
    expect(canEditEvent(on('shared', 'mine'), calendars)).toBe(true)
  })

  it('is true on a calendar the list does not know', () => {
    expect(canEditEvent(on('elsewhere'), calendars)).toBe(true)
    expect(canEditEvent(on('shared'), undefined)).toBe(true)
  })
})

describe('carriedVisibility', () => {
  const team = cal('team', { may_write_all: 0 })
  const archive = cal('archive', { may_write_all: 0 })
  const holidays = { ...cal('h1', { may_write_all: 0 }), name: 'external|h1', account: 'external' }

  it('keeps drawn the shared calendars the old list did not hide, and hidden the ones it did', () => {
    expect(carriedVisibility([cal('mine'), team, archive], ['acc|archive'], {})).toEqual({
      'acc|team': 1,
      'acc|archive': 0,
    })
  })

  it("starts the site's own calendars unticked, whatever the old list says", () => {
    expect(carriedVisibility([team, holidays], [], {})).toEqual({ 'acc|team': 1 })
  })

  it('leaves a choice already made in the map alone', () => {
    expect(carriedVisibility([team], [], { 'acc|team': 0 })).toEqual({ 'acc|team': 0 })
  })
})

describe('onShownCalendar', () => {
  const drawn = onShownCalendar([cal('mine'), cal('birthdays', { may_write_all: 0, visible: 0 })])

  it('draws an event on a calendar being shown, named or carried', () => {
    expect(drawn({ calendars: ['acc|mine'] })).toBe(true)
    expect(drawn({ calendars: [{ calendar: 'acc|mine' }] })).toBe(true)
  })

  it('leaves a switched-off calendar out', () => {
    expect(drawn({ calendars: ['acc|birthdays'] })).toBe(false)
    expect(drawn({ calendars: [{ calendar: 'acc|birthdays' }] })).toBe(false)
  })

  it('draws nothing until the calendar list is known, and nothing the list does not have', () => {
    expect(onShownCalendar(undefined)({ calendars: ['acc|mine'] })).toBe(false)
    expect(drawn({ calendars: ['acc|elsewhere'] })).toBe(false)
  })

  it('draws an event on two calendars where either is shown', () => {
    expect(drawn({ calendars: ['acc|birthdays', 'acc|mine'] })).toBe(true)
  })
})
