/**
 * A new event another area asks for, filled in from what it was looking at — a mail, say.
 *
 * Held here between the asking and the form opening rather than put in the URL: what it carries is
 * someone's mail, and a URL is kept in history and passed around. The URL carries only the key it
 * is held under (`?new=<key>`), so a navigation that never arrives can't hand it to the next
 * `?new=1`. Taken once, so a reload or Back opens an empty form, as `?new=1` alone does.
 */
export interface NewEventDraft {
  title?: string
  description?: string
  participants?: readonly { email: string; name?: string }[]
}

export interface NewEventDrafts {
  /** Holds `draft` for the form `?new=<key>` opens, in place of any held before, and returns that key. */
  hold(draft: NewEventDraft): string
  /** The draft held under `key`, once. Any take lets go of what was held, matched or not. */
  take(key: unknown): NewEventDraft | undefined
}

export function createNewEventDrafts(): NewEventDrafts {
  let held: { key: string; draft: NewEventDraft } | undefined
  let count = 0
  return {
    hold(draft) {
      count += 1
      // Never '1', the flag a plain new event asks with.
      held = { key: `draft-${count}`, draft }
      return held.key
    },
    take(key) {
      const taken = held
      held = undefined
      return taken?.key === key ? taken?.draft : undefined
    },
  }
}

const singleton = createNewEventDrafts()

export function useNewEventDrafts(): NewEventDrafts {
  return singleton
}

/** The draft's people as guests of the new event, each still to reply. */
export const draftGuests = (draft: NewEventDraft | undefined) =>
  (draft?.participants ?? []).map((person) => ({
    email: person.email,
    _name: person.name,
    participation_status: 'NEEDS-ACTION',
    expect_reply: true,
    isNew: true,
  }))

/**
 * `participants` with `organizer` first, and none of the reader's own addresses — the organizer's
 * among them, in any case — left as a guest. A form filled in from a mail can open before the
 * identities that say who the reader is have loaded, so this runs again once they have.
 */
export const seatOrganizer = <O extends { email: string }, P extends { email: string }>(
  participants: readonly P[],
  organizer: O,
  ownAddresses: readonly string[],
): (O | P)[] => {
  const own = new Set([organizer.email, ...ownAddresses].map((address) => address.toLowerCase()))
  return [organizer, ...participants.filter((person) => !own.has(person.email.toLowerCase()))]
}
