import { describe, expect, it } from 'vitest'

import {
  draftGuests,
  newEventTimes,
  seatOrganizer,
  withoutReader,
} from '@/apps/calendar/utils/newEventDraft'

const draft = {
  title: 'Q4 planning',
  start: { date: '2026-11-19', time: '15:00' },
  participants: [
    { email: 'Me@Example.com', name: 'Me' },
    { email: 'lena@example.com', name: 'Lena' },
  ],
}
const organizer = { email: 'me@example.com', participation_status: 'ACCEPTED' }
const emails = (people: { email: string }[]) => people.map((person) => person.email)

describe('when a new event filled in elsewhere runs', () => {
  // The form was asked for from Wednesday's 07:30 slot; the draft names its own time.
  const slot = { date: '2026-11-18', time: '07:30', isAllDay: false }

  it('starts at the time it names, for the usual length', () => {
    expect(newEventTimes({ start: { date: '2026-11-19', time: '15:00' } }, slot, 60)).toEqual({
      isAllDay: false,
      startDate: '2026-11-19',
      startTime: '15:00',
      endDate: '2026-11-19',
      endTime: '16:00',
    })
  })

  it('runs from the start to the end of a range', () => {
    const range = {
      start: { date: '2026-11-20', time: '15:00' },
      end: { date: '2026-11-20', time: '16:30' },
    }
    expect(newEventTimes(range, slot, 60)).toMatchObject({
      isAllDay: false,
      startDate: '2026-11-20',
      startTime: '15:00',
      endDate: '2026-11-20',
      endTime: '16:30',
    })
  })

  it('is all day on a day named without a time', () => {
    expect(newEventTimes({ start: { date: '2026-11-20' } }, slot, 60)).toMatchObject({
      isAllDay: true,
      startDate: '2026-11-20',
      endDate: '2026-11-20',
    })
    const days = { start: { date: '2026-11-20' }, end: { date: '2026-11-22' } }
    expect(newEventTimes(days, slot, 60)).toMatchObject({
      isAllDay: true,
      startDate: '2026-11-20',
      endDate: '2026-11-22',
    })
  })

  it('crosses midnight when the usual length takes it there', () => {
    expect(newEventTimes({ start: { date: '2026-11-19', time: '23:30' } }, slot, 60)).toMatchObject(
      { startDate: '2026-11-19', endDate: '2026-11-20', endTime: '00:30' },
    )
  })

  it('opens on the slot it was asked from when it names no time', () => {
    expect(newEventTimes({ title: 'Q4 planning' }, slot, 60)).toEqual({
      isAllDay: false,
      startDate: '2026-11-18',
      startTime: '07:30',
      endDate: '2026-11-18',
      endTime: '08:30',
    })
  })
})

describe('the reader among the guests', () => {
  it('is never a guest, whatever case the mail spelled them in', () => {
    const guests = withoutReader(draftGuests(draft), ['me@example.com'])
    expect(emails(guests)).toEqual(['lena@example.com'])
  })

  it('is left out even with no organizer to seat', () => {
    // The account has addresses but none it can organize from: no organizer row.
    const guests = withoutReader(draftGuests(draft), ['me@example.com', 'me+cal@example.com'])
    expect(emails(guests)).toEqual(['lena@example.com'])
  })

  it('keeps the organizer row, theirs as it is, when identities land later', () => {
    const form = seatOrganizer(
      draftGuests({
        participants: [{ email: 'lena@example.com' }, { email: 'ME+cal@example.com' }],
      }),
      organizer,
    )
    const after = withoutReader(form, ['me@example.com', 'me+cal@example.com'], organizer.email)
    expect(emails(after)).toEqual(['me@example.com', 'lena@example.com'])
  })

  it('has the organizer once, first', () => {
    const people = seatOrganizer(draftGuests(draft), organizer)
    expect(emails(people)).toEqual(['me@example.com', 'lena@example.com'])
  })
})
