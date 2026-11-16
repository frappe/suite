import { beforeEach, describe, expect, it } from 'vitest'

import {
  createNewEventDrafts,
  draftGuests,
  newEventTimes,
  seatOrganizer,
  withoutReader,
} from '@/apps/calendar/utils/newEventDraft'

const draft = {
  title: 'Q4 planning',
  participants: [
    { email: 'Me@Example.com', name: 'Me' },
    { email: 'lena@example.com', name: 'Lena' },
  ],
}
const organizer = { email: 'me@example.com', participation_status: 'ACCEPTED' }
const emails = (people: { email: string }[]) => people.map((person) => person.email)

beforeEach(() => window.sessionStorage.clear())

describe('a new event filled in elsewhere', () => {
  it('opens in the form its own navigation leads to, once', () => {
    const drafts = createNewEventDrafts()
    const key = drafts.hold(draft)
    expect(drafts.take(key)).toEqual(draft)
    // Reload or Back on the same URL: an empty form.
    expect(drafts.take(key)).toBeUndefined()
  })

  it('survives the page load an iPhone makes on the way into Calendar', () => {
    const key = createNewEventDrafts().hold(draft)
    // The page that loads starts with nothing in memory.
    const afterLoad = createNewEventDrafts()
    expect(afterLoad.take(key)).toEqual(draft)
    expect(createNewEventDrafts().take(key)).toBeUndefined()
  })

  it('is not filled into a form that opens long after it was asked for', () => {
    let clock = Date.parse('2026-11-16T10:00:00Z')
    const key = createNewEventDrafts(undefined, () => clock).hold(draft)
    clock += 60 * 60_000
    expect(createNewEventDrafts(undefined, () => clock).take(key)).toBeUndefined()
  })

  it('is not filled into the next plain new event when its navigation never arrived', () => {
    const drafts = createNewEventDrafts()
    drafts.hold(draft)
    // The navigation was aborted, so nothing took it; later the phone's button asks for ?new=1.
    expect(drafts.take('1')).toBeUndefined()
  })

  it('leaves its time empty for the reader to pick', () => {
    expect(newEventTimes(draft, '10:00', 60)).toEqual({ startTime: '', endTime: '' })
    // A plain new event keeps its hour from the slot.
    expect(newEventTimes(undefined, '07:30', 60)).toEqual({ startTime: '07:30', endTime: '08:30' })
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
