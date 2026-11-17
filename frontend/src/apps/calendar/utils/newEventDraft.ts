import { newGuest } from '@/apps/calendar/utils'
import dayjs from '@/apps/calendar/utils/dayjs'

/**
 * A new event another area asks for, filled in from what it was looking at — a mail, say.
 *
 * Held in the tab's session storage between the asking and the form opening rather than put in the
 * URL: what it carries is someone's mail, and a URL is kept in history and passed around. Storage,
 * not memory, because on an iPhone moving into Calendar loads the page afresh (see the router). The
 * URL carries only the key it is held under (`?new=<key>`), so a navigation that never arrives
 * can't hand it to the next `?new=1`. Taken once, so a reload or Back opens an empty form, as
 * `?new=1` alone does, and one not taken soon goes stale rather than turning up later.
 */
export interface NewEventDraft {
  title?: string
  description?: string
  participants?: readonly { email: string; name?: string }[]
  /** When it starts. */
  start?: DraftMoment
  /** When it ends, for a range; without one it runs the usual length. */
  end?: DraftMoment
}

/** A day (`YYYY-MM-DD`), and the time on it (`HH:mm`) when there is one. A day alone is all day. */
export interface DraftMoment {
  date: string
  time?: string
}

export interface NewEventDrafts {
  /** Holds `draft` for the form `?new=<key>` opens, in place of any held before, and returns that key. */
  hold(draft: NewEventDraft): string
  /** The draft held under `key`, once. Any take lets go of what was held, matched or not. */
  take(key: unknown): NewEventDraft | undefined
}

interface Held {
  key: string
  draft: NewEventDraft
  at: number
}

const STORAGE_KEY = 'calendar:new-event-draft'
// Long enough for a page load on a slow phone, short enough that a draft never asked for again
// doesn't fill in a form much later.
const DRAFT_LIFETIME_MS = 5 * 60_000

const sessionStore = () => window.sessionStorage

export function createNewEventDrafts(
  storage: () => Storage = sessionStore,
  now: () => number = Date.now,
): NewEventDrafts {
  // Session storage can be missing or refuse (a private window); the draft then lives as long as
  // the page does.
  let inMemory: Held | undefined
  const read = (): Held | undefined => {
    try {
      const raw = storage().getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return inMemory
  }
  const write = (held: Held | undefined) => {
    inMemory = held
    try {
      if (held) storage().setItem(STORAGE_KEY, JSON.stringify(held))
      else storage().removeItem(STORAGE_KEY)
    } catch {}
  }
  return {
    hold(draft) {
      // Never '1', the flag a plain new event asks with, and new after a page load too.
      const key = `draft-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      write({ key, draft, at: now() })
      return key
    },
    take(key) {
      const taken = read()
      write(undefined)
      if (!taken || taken.key !== key || now() - taken.at > DRAFT_LIFETIME_MS) return undefined
      return taken.draft
    },
  }
}

/** The drafts held between the asking area and Calendar's new-event form. */
export const newEventDrafts = createNewEventDrafts()

/** The draft's people as guests of the new event, each still to reply. */
export const draftGuests = (draft: NewEventDraft | undefined) =>
  (draft?.participants ?? []).map((person) => newGuest(person.email, person.name))

const lower = (address: string) => address.toLowerCase()

/**
 * `participants` without the reader as a guest: none of their own addresses is invited to their own
 * event. The organizer's row, when there is one, is theirs too and stays. A form can open before the
 * identities that say who the reader is have loaded, so this runs again once they have.
 */
export const withoutReader = <P extends { email: string }>(
  participants: readonly P[],
  ownAddresses: readonly string[],
  organizer?: string,
): P[] => {
  const own = new Set(ownAddresses.map(lower))
  return participants.filter(
    (person) => !own.has(lower(person.email)) || lower(person.email) === lower(organizer ?? ''),
  )
}

/** `participants` with `organizer` first, and only there, however the others spelled them. */
export const seatOrganizer = <O extends { email: string }, P extends { email: string }>(
  participants: readonly P[],
  organizer: O,
): (O | P)[] => [
  organizer,
  ...participants.filter((person) => lower(person.email) !== lower(organizer.email)),
]

/** When a new event runs, as its form holds it. */
export interface NewEventTimes {
  isAllDay: boolean
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

/**
 * When a new event runs as its form opens. A draft that says when opens there: a range from its
 * start to its end, a time alone for `minutes`, and a day with no time as an all-day event. Any
 * other opens on the slot it was asked from, for `minutes`. An all-day event still carries the
 * slot's hours, for the form to fall back on if the reader makes it a timed one.
 */
export const newEventTimes = (
  draft: NewEventDraft | undefined,
  slot: { date: string; time: string; isAllDay: boolean },
  minutes: number,
): NewEventTimes => {
  const slotEnd = dayjs(slot.time, 'HH:mm').add(minutes, 'minute').format('HH:mm')
  const start = draft?.start
  if (!start)
    return {
      isAllDay: slot.isAllDay,
      startDate: slot.date,
      startTime: slot.time,
      endDate: slot.date,
      endTime: slotEnd,
    }
  if (!start.time) {
    const last = draft?.end?.date
    return {
      isAllDay: true,
      startDate: start.date,
      startTime: slot.time,
      endDate: last && last > start.date ? last : start.date,
      endTime: slotEnd,
    }
  }
  const startsAt = dayjs(`${start.date}T${start.time}`)
  const named = draft?.end?.time ? dayjs(`${draft.end.date}T${draft.end.time}`) : undefined
  const endsAt = named?.isAfter(startsAt) ? named : startsAt.add(minutes, 'minute')
  return {
    isAllDay: false,
    startDate: startsAt.format('YYYY-MM-DD'),
    startTime: startsAt.format('HH:mm'),
    endDate: endsAt.format('YYYY-MM-DD'),
    endTime: endsAt.format('HH:mm'),
  }
}
