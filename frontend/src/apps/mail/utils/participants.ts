import type { Mail, ThreadParticipant } from '@/apps/mail/types'

// Past this many names the middle of the list is dropped for an ellipsis, keeping the
// thread's first sender and its two most recent — the ends identify a conversation.
const MAX_PARTICIPANTS_SHOWN = 3

/**
 * Everyone who has written in a thread, in the order they first wrote, de-duplicated by name and
 * address. This is what the list row names, in place of the latest message's sender alone: a thread
 * you have replied to led with your own name, which read as though you had started it.
 *
 * It is derived here rather than served alongside the row because a row already carries its whole
 * conversation (see serialize_thread) — the names are in hand, and a second copy of them could only
 * disagree. Should the list payload ever be trimmed to one message per row, this moves back to the
 * server, which is the only thing that would still know the cast.
 *
 * De-duplicating by address alone hid everyone behind a relay. Discourse, GitHub, Jira and the like
 * send every writer through one envelope address and put the person in the display name, so a forum
 * thread five people had posted in was named after whoever posted first, its cast reachable only by
 * opening it. On such a thread the address is transport and the name is the identity, which is why
 * both make the key. The cost is that one writer whose client varies their display name ("Bob", "Bob
 * Smith") takes two places in the row; correspondence rarely does this, and a name that is wrong is
 * worse than a name repeated.
 *
 * A message carrying no display name is not taken for a second writer: it would be shown as the bare
 * address, sat next to the names from that same address. It falls in with whoever else has written
 * from there — and where it arrives first, the first name to follow adopts its entry, so the row
 * reads "Umair" rather than "noreply@discuss.frappe.io, Umair".
 *
 * `ownEmails` is the account's own addresses, lowercased; the entries it matches are the ones the row
 * says "me" for. Search results are single messages with no conversation behind them, and name their
 * own sender rather than anyone here.
 */
export const threadParticipants = (
	messages: Mail[] | undefined,
	ownEmails: Set<string>,
): ThreadParticipant[] => {
	const participants: ThreadParticipant[] = []
	const seen = new Set<string>()
	const addresses = new Set<string>()

	for (const message of messages ?? []) {
		const email = (message.from_email ?? '').trim()
		if (!email) continue

		const address = email.toLowerCase()
		const name = (message.from_name ?? '').trim()
		const key = `${address}|${name.toLowerCase()}`
		if (seen.has(key)) continue

		if (!name) {
			if (addresses.has(address)) continue
		} else {
			const unnamed = participants.find((p) => !p.name && p.email.toLowerCase() === address)
			if (unnamed) {
				unnamed.name = name
				seen.add(key)
				continue
			}
		}

		seen.add(key)
		addresses.add(address)
		participants.push({ name, email, is_self: ownEmails.has(address) })
	}

	return participants
}

const getFirstAlphabet = (str?: string) => str?.match(/\p{L}/u)?.[0]

/** The letter on a sender's avatar: their name's first, or their address's when they go by no name. */
export const getSenderInitial = (sender: { from_name?: string; from_email?: string }) =>
	getFirstAlphabet(sender.from_name) || getFirstAlphabet(sender.from_email)

const capitalizeFirst = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

// "M", "M." — an initial standing before the name rather than being it.
const isInitial = (word: string) => /^\p{L}\.?$/u.test(word)

// The name a person goes by in a line of several: their first, except where that is an initial, which
// names nobody — "M Umair Sayed" reads as "M Umair". Relay threads (a forum, an issue tracker) made
// this worth handling: they name several people on rows that used to name one.
const firstNameOf = (fullName: string) => {
	const [first, second] = fullName.split(/\s+/)
	return isInitial(first) && second ? `${first} ${second}` : first
}

/**
 * The participant a row's avatar stands for: the first person in the thread who isn't the user,
 * falling back to the user themselves for a thread only they have written in.
 *
 * The avatar IMAGE is chosen server-side by the same rule (add_user_images_to_emails skips the user's
 * own addresses), so deriving the fallback letter from anywhere else — the latest sender, say, which is
 * the user on any thread they have answered — puts one person's initial on another's photo.
 */
const primaryParticipant = (participants: ThreadParticipant[]): ThreadParticipant | undefined =>
	participants.find((p) => !p.is_self) ?? participants[0]

/**
 * The name(s) a thread row goes by: everyone who has written in it, in the order they
 * first wrote, with the user's own addresses collapsed to "me" — "Alice, me",
 * "Alice … Carol, me", "Me, Alice".
 *
 * A thread is named after its participants rather than after its latest sender because
 * replying to one made the row read as though the user had sent it: an incoming mail
 * answered once was filed under the answerer's own name, with no trace of who had
 * written in. Everyone keeps their place in the conversation, so an inbox thread still
 * leads with whoever started it.
 *
 * Several names are shortened to first names to fit the line; a lone participant keeps
 * their full one.
 */
export const formatThreadParticipants = (participants: ThreadParticipant[]) => {
	// The user may have written from more than one of their addresses; they're still one name.
	const firstSelf = participants.findIndex((p) => p.is_self)
	const distinct = participants.filter((p, i) => !p.is_self || i === firstSelf)
	if (!distinct.length) return ''

	const nameOf = ({ name, email, is_self }: ThreadParticipant, firstNameOnly: boolean) => {
		if (is_self) return __('me')
		const fullName = name.trim()
		if (!fullName) return email
		return firstNameOnly ? firstNameOf(fullName) : fullName
	}

	// "me" is a word standing in for a name, so it reads lowercase inside the line ("Figma, me")
	// and is capitalized only where it heads the row. Real names arrive capitalized already, and an
	// address standing in for a missing name ("noreply@frappe.io") must be left exactly as it is.
	const names = distinct.map((participant, i) => {
		const name = nameOf(participant, distinct.length > 1)
		return i === 0 && participant.is_self ? capitalizeFirst(name) : name
	})

	if (names.length <= MAX_PARTICIPANTS_SHOWN) return names.join(', ')
	return `${names[0]} … ${names.slice(-2).join(', ')}`
}

/**
 * The letter behind a thread row's avatar, for a contact with no picture: the initial of whoever the
 * picture itself would be of (see primaryParticipant). `fallback` is the row's own sender, for a row
 * with no conversation behind it to name anybody — a search result.
 */
export const threadAvatarLabel = (
	participants: ThreadParticipant[],
	fallback: { from_name?: string; from_email?: string },
) => {
	const primary = primaryParticipant(participants)
	if (!primary) return getSenderInitial(fallback)
	return getSenderInitial({ from_name: primary.name, from_email: primary.email })
}

/** The name(s) a thread row goes by, falling back to its own sender when it names nobody. */
export const threadDisplayName = (
	participants: ThreadParticipant[],
	fallback: { from_name?: string; from_email?: string },
) => formatThreadParticipants(participants) || fallback.from_name || fallback.from_email
