import { describe, expect, it } from 'vitest'

import {
  createNewEventDrafts,
  draftGuests,
  seatOrganizer,
} from '@/apps/calendar/utils/newEventDraft'

const draft = {
  title: 'Q4 planning',
  participants: [
    { email: 'Me@Example.com', name: 'Me' },
    { email: 'lena@example.com', name: 'Lena' },
  ],
}
const organizer = { email: 'me@example.com', participation_status: 'ACCEPTED' }

describe('a new event filled in elsewhere', () => {
  it('opens in the form its own navigation leads to, once', () => {
    const drafts = createNewEventDrafts()
    const key = drafts.hold(draft)
    expect(drafts.take(key)).toEqual(draft)
    // Reload or Back on the same URL: an empty form.
    expect(drafts.take(key)).toBeUndefined()
  })

  it('is not filled into the next plain new event when its navigation never arrived', () => {
    const drafts = createNewEventDrafts()
    drafts.hold(draft)
    // The navigation was aborted, so nothing took it; later the phone's button asks for ?new=1.
    expect(drafts.take('1')).toBeUndefined()
  })

  it('has the reader once, as organizer, whatever case the mail spelled them in', () => {
    const people = seatOrganizer(draftGuests(draft), organizer, [])
    expect(people.map((person) => person.email)).toEqual(['me@example.com', 'lena@example.com'])
  })

  it('drops the reader from a guest list filled in before their identities loaded', () => {
    // The form opened with no identities yet, so every guest the mail had is on it.
    const before = draftGuests({
      participants: [{ email: 'lena@example.com' }, { email: 'ME+calendar@example.com' }],
    })
    // Then they land: the organizer is seated and the reader's other address goes.
    const after = seatOrganizer(before, organizer, ['me@example.com', 'me+calendar@example.com'])
    expect(after.map((person) => person.email)).toEqual(['me@example.com', 'lena@example.com'])
  })
})
