import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The two accounts a test can be given; a test that wants one account empties this first.
const accounts = vi.hoisted(() => ({ value: ['work', 'personal'] }))
// Every payload the search endpoint was submitted with, oldest first.
const searches = vi.hoisted(() => [] as Record<string, unknown>[])

// Stands in for the real resource in the ways this composable can tell apart: a reply fills `data`
// and calls back, `reset` empties it, and `abort` leaves it alone — which is how asking again
// differs from having been answered.
const answer = vi.hoisted(() => ({
	value: (_rows?: unknown[], _matched?: number) => {},
}))

vi.mock('frappe-ui', async () => {
	// Reactive like the real one, or a computed over `data` never learns the reply arrived.
	const { reactive } = await import('vue')
	const createResource = ({
		url,
		onSuccess,
	}: {
		url: string
		onSuccess?: (data: unknown) => void
	}) => {
		const resource = reactive({
			data: null as unknown,
			submit: Object.assign(
				(payload: Record<string, unknown>) => {
					if (!url.endsWith('search_mails')) return
					searches.push(payload)
					answer.value = (rows = [], matched = 0) => {
						resource.data = [rows, matched]
						onSuccess?.(resource.data)
					}
				},
				{ cancel: vi.fn() },
			),
			abort: vi.fn(),
			reset: vi.fn(() => {
				resource.data = null
			}),
			setData: (data: unknown) => {
				resource.data = data
			},
		})
		return resource
	}
	return { createResource }
})

vi.mock('@/apps/mail/stores/user', () => ({
	userStore: () => ({
		userResource: { data: { accounts: accounts.value } },
		mailboxes: { data: [{ id: 'mailbox-1', _name: 'Inbox' }] },
	}),
}))

import { useMailCommandPaletteSearch } from './useMailCommandPaletteSearch'

function openSearch() {
	const query = ref('')
	return { query, ...useMailCommandPaletteSearch(query, ref(true)) }
}

beforeEach(() => {
	searches.length = 0
	accounts.value = ['work', 'personal']
	localStorage.clear()
})

describe('opening the filter panel', () => {
	it('takes over the operators typed on the query line, leaving the words', () => {
		const search = openSearch()
		search.query.value = 'budget from:alice@example.com after:2026-03-01'

		search.absorbQueryFilters()

		expect(search.query.value).toBe('budget')
		expect(search.filterValues.value).toEqual({
			from: 'alice@example.com',
			after: '2026-03-01',
		})
	})

	it('keeps filters already held alongside the ones it takes over', () => {
		const search = openSearch()
		search.applyFilter('inMailbox', 'mailbox-1')
		search.query.value = 'subject:invoice'

		search.absorbQueryFilters()

		expect(search.filterValues.value).toEqual({
			inMailbox: 'mailbox-1',
			subject: 'invoice',
		})
	})

	// The parser does not know `in:` — a folder's name has to become its id, which only the
	// composable can do — so it must be taken off the line before the parser sees it.
	it('restores a folder from its name, as an edited folder chip leaves it', () => {
		const search = openSearch()
		search.query.value = 'budget in:Inbox'

		search.absorbQueryFilters()

		expect(search.query.value).toBe('budget')
		expect(search.filterValues.value).toEqual({ inMailbox: 'mailbox-1' })
	})

	it('leaves a folder name nothing answers to as the words typed', () => {
		const search = openSearch()
		search.query.value = 'in:Nowhere budget'

		search.absorbQueryFilters()

		expect(search.query.value).toBe('in:Nowhere budget')
		expect(search.filterValues.value).toEqual({})
	})

	it('leaves a plain query alone', () => {
		const search = openSearch()
		search.query.value = 'quarterly budget'

		search.absorbQueryFilters()

		expect(search.query.value).toBe('quarterly budget')
		expect(search.filterValues.value).toEqual({})
	})
})

describe('what a badge says', () => {
	// However a filter arrived, the badge reads as the query that would fetch it again — so the row
	// speaks one language, and reading it teaches the operators.
	it('shows every filter as the query it stands for', () => {
		const search = openSearch()
		search.setFilters({
			inMailbox: 'mailbox-1',
			from: 'alice@example.com',
			subject: 'invoice',
			after: '2026-01-01',
			hasAttachment: 'true',
			isRead: 'false',
		})

		expect(
			search.appliedFilters.value.map((filter) =>
				search.getFilterLabel(filter),
			),
		).toEqual([
			'in:Inbox',
			'from:alice@example.com',
			'subject:invoice',
			'after:2026-01-01',
			'has:attachments',
			'is:unread',
		])
	})

	it('says the same thing for a filter typed as an operator and one applied directly', () => {
		const typed = openSearch()
		typed.query.value = 'has:attachments'
		typed.absorbQueryFilters()

		const applied = openSearch()
		applied.applyFilter('hasAttachment', 'true')

		expect(typed.getFilterLabel(typed.appliedFilters.value[0])).toBe(
			applied.getFilterLabel(applied.appliedFilters.value[0]),
		)
	})
})

describe('asking for an operator', () => {
	const selected = (query: string, range: { start: number; end: number }) =>
		query.slice(range.start, range.end)

	it('writes the operator once, however many times it is asked for', () => {
		const search = openSearch()

		search.useOperator('from')
		search.useOperator('from')
		search.useOperator('from')

		expect(search.query.value).toBe('from:')
	})

	it('points at what was typed after it, rather than starting another one', () => {
		const search = openSearch()
		search.useOperator('from')
		search.query.value = 'from:alice@example.com'

		const range = search.useOperator('from')

		expect(search.query.value).toBe('from:alice@example.com')
		expect(selected(search.query.value, range)).toBe('alice@example.com')
	})

	it('waits at the empty one it already wrote', () => {
		const search = openSearch()
		search.useOperator('from')

		const range = search.useOperator('from')

		expect(range).toEqual({ start: 'from:'.length, end: 'from:'.length })
	})

	it('adds a different operator after the words already there', () => {
		const search = openSearch()
		search.query.value = 'budget'

		const range = search.useOperator('to')

		expect(search.query.value).toBe('budget to:')
		expect(range.start).toBe('budget to:'.length)
	})
})

describe('editing a filter', () => {
	// What the caller selects in the input, read back off the query it was given.
	const selected = (query: string, range: { start: number; end: number } | null) =>
		range ? query.slice(range.start, range.end) : null

	it('hands the filter back to the query line as the token that set it', () => {
		const search = openSearch()
		search.applyFilter('to', 'x@frappe.io')

		search.editFilter('to')

		expect(search.query.value).toBe('to:x@frappe.io')
		expect(search.filterValues.value).toEqual({})
	})

	it('points at the value, so typing replaces what was searched for', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.applyFilter('to', 'x@frappe.io')

		const range = search.editFilter('to')

		expect(selected(search.query.value, range)).toBe('x@frappe.io')
	})

	it('takes the quotes with the value, so replacing it replaces them too', () => {
		const search = openSearch()
		search.applyFilter('subject', 'quarterly report')

		const range = search.editFilter('subject')

		expect(selected(search.query.value, range)).toBe('"quarterly report"')
	})

	it('keeps what was already typed, and adds the token after it', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.applyFilter('to', 'x@frappe.io')

		search.editFilter('to')

		expect(search.query.value).toBe('budget to:x@frappe.io')
	})

	it('fills an operator the query line already carries, rather than repeating it', () => {
		const search = openSearch()
		search.query.value = 'from:someone@else.com'
		search.applyFilter('from', 'alice@example.com')

		const range = search.editFilter('from')

		expect(search.query.value).toBe('from:alice@example.com')
		expect(selected(search.query.value, range)).toBe('alice@example.com')
	})

	it('fills one mid-sentence without disturbing the words around it', () => {
		const search = openSearch()
		search.query.value = 'budget from:someone@else.com urgent'
		search.applyFilter('from', 'alice@example.com')

		const range = search.editFilter('from')

		expect(search.query.value).toBe('budget from:alice@example.com urgent')
		expect(selected(search.query.value, range)).toBe('alice@example.com')
	})

	it('completes an operator left half-typed', () => {
		const search = openSearch()
		search.query.value = 'budget to:'
		search.applyFilter('to', 'x@frappe.io')

		search.editFilter('to')

		expect(search.query.value).toBe('budget to:x@frappe.io')
	})

	it('leaves a different operator where it is', () => {
		const search = openSearch()
		search.query.value = 'from:someone@else.com'
		search.applyFilter('to', 'x@frappe.io')

		search.editFilter('to')

		expect(search.query.value).toBe('from:someone@else.com to:x@frappe.io')
	})

	it('quotes a value with spaces, so it comes back as one token', () => {
		const search = openSearch()
		search.applyFilter('subject', 'quarterly report')

		search.editFilter('subject')

		expect(search.query.value).toBe('subject:"quarterly report"')
	})

	it('gives a folder back by name, which is what the operator takes', () => {
		const search = openSearch()
		search.applyFilter('inMailbox', 'mailbox-1')

		search.editFilter('inMailbox')

		expect(search.query.value).toBe('in:Inbox')
	})

	it('round-trips: what comes back sets the same filter when typed again', () => {
		const search = openSearch()
		search.applyFilter('to', 'x@frappe.io')

		search.editFilter('to')
		search.absorbQueryFilters()

		expect(search.filterValues.value).toEqual({ to: 'x@frappe.io' })
	})
})

describe('inverting a filter', () => {
	it('flips the two-answer filters and says so', () => {
		const search = openSearch()
		search.applyFilter('hasAttachment', 'true')

		search.invertFilter('hasAttachment')

		expect(search.filterValues.value.hasAttachment).toBe('false')
		expect(search.getFilterLabel(search.appliedFilters.value[0])).toBe(
			'has:no-attachments',
		)

		search.invertFilter('hasAttachment')

		expect(search.filterValues.value.hasAttachment).toBe('true')
	})

	it('reads unread as read and back', () => {
		const search = openSearch()
		search.applyFilter('isRead', 'false')

		search.invertFilter('isRead')

		expect(search.getFilterLabel(search.appliedFilters.value[0])).toBe('is:read')
	})

	it('inverts in place, so the badge does not move down the row', () => {
		const search = openSearch()
		search.applyFilter('isRead', 'false')
		search.applyFilter('from', 'alice@example.com')

		search.invertFilter('isRead')

		expect(search.appliedFilters.value.map(({ key }) => key)).toEqual([
			'isRead',
			'from',
		])
	})

	it('offers the flip only where there is a second answer to give', () => {
		const search = openSearch()

		expect(search.canInvert('hasAttachment')).toBe(true)
		expect(search.canInvert('isRead')).toBe(true)
		expect(search.canInvert('from')).toBe(false)
		expect(search.canInvert('inMailbox')).toBe(false)
	})

	it('leaves a filter it cannot flip alone', () => {
		const search = openSearch()
		search.applyFilter('from', 'alice@example.com')

		search.invertFilter('from')

		expect(search.filterValues.value.from).toBe('alice@example.com')
	})
})

describe('whether the results are the answer', () => {
	it('is pending from the keystroke until the server replies', () => {
		const search = openSearch()

		search.query.value = 'invoice'
		search.search('invoice', 'work')
		expect(search.pending.value).toBe(true)

		answer.value()

		expect(search.pending.value).toBe(false)
	})

	it('goes back to pending when the query moves on', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value()

		search.query.value = 'invoices'

		expect(search.pending.value).toBe(true)
	})

	// The previous request is aborted and reset on every keystroke, which stops its loading
	// without answering anything — the flicker that read "No results" mid-word.
	it('stays pending while a request is replaced rather than answered', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')

		search.cancel()

		expect(search.pending.value).toBe(true)
	})

	// Opening the filter panel and closing it again re-runs the watcher with the search unchanged.
	it('does not ask the same question twice, so the answer stays on screen', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value()
		const asked = searches.length

		search.search('invoice', 'work')

		expect(searches.length).toBe(asked)
	})

	// The palette clears its query as it closes, which resets the resource; reopened over the
	// same results, it asks the same question — and should get the same answer, not a request.
	it('hands back the answer it already has when the same search is asked again after a reset', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value([{ thread_id: 't1', account: 'work', from_email: 'a@b.com' }], 3)
		const asked = searches.length

		search.query.value = ''
		search.search('', 'work')
		expect(search.results.value).toHaveLength(0)

		search.query.value = 'invoice'
		search.search('invoice', 'work')

		expect(searches.length).toBe(asked)
		expect(search.results.value).toHaveLength(1)
		expect(search.pending.value).toBe(false)
	})

	it('asks again once a filter changes the question', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value()
		const asked = searches.length

		search.applyFilter('inMailbox', 'mailbox-1')
		search.search('invoice', 'work')

		expect(searches.length).toBe(asked + 1)
	})

	it('asks again when the same words are asked of a different account', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value([{ thread_id: 't1', account: 'work', from_email: 'a@b.com' }], 1)
		const asked = searches.length

		search.search('invoice', 'personal')

		expect(searches.length).toBe(asked + 1)
		expect(searches.at(-1)).toMatchObject({ account: 'personal' })
		expect(search.pending.value).toBe(true)
	})

	it('asks again for a different question once the results have been cleared', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')
		answer.value()
		const asked = searches.length

		search.reset()
		search.query.value = 'receipt'
		search.search('receipt', 'work')

		expect(searches.length).toBe(asked + 1)
	})

	it('is settled when there is nothing to search for', () => {
		const search = openSearch()

		search.query.value = ''
		search.search('', 'work')

		expect(search.pending.value).toBe(false)
	})

	it('is settled while an operator is still being typed', () => {
		const search = openSearch()

		search.query.value = 'from:'
		search.search('from:', 'work')

		expect(search.pending.value).toBe(false)
	})
})

describe('how many matched', () => {
	const mail = { thread_id: 't1', account: 'work', from_email: 'a@b.com' }

	it('reports the whole count, not the page it was given', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')

		answer.value([mail], 42)

		expect(search.results.value).toHaveLength(1)
		expect(search.total.value).toBe(42)
	})

	it('is nothing before an answer arrives', () => {
		const search = openSearch()
		search.query.value = 'invoice'
		search.search('invoice', 'work')

		expect(search.total.value).toBe(0)
	})
})

describe('searching every account', () => {
	it('asks the server for every account only once it is turned on', () => {
		const search = openSearch()

		search.search('invoice', 'work')
		expect(searches.at(-1)).toMatchObject({ all_accounts: false })

		search.allAccounts.value = true
		search.search('invoice', 'work')

		expect(searches.at(-1)).toMatchObject({ all_accounts: true })
	})

	it('does not widen a search for someone who only has one account', () => {
		accounts.value = ['work']
		const search = openSearch()

		search.allAccounts.value = true
		search.search('invoice', 'work')

		expect(search.searchesAllAccounts.value).toBe(false)
		expect(searches.at(-1)).toMatchObject({ all_accounts: false })
	})

	it('drops the folder filter, which belongs to a single account', async () => {
		const search = openSearch()
		search.applyFilter('inMailbox', 'mailbox-1')

		search.allAccounts.value = true
		await nextTick()

		expect(search.filterValues.value.inMailbox).toBeUndefined()
	})

	it('remembers the choice for the next search', async () => {
		const first = openSearch()
		first.allAccounts.value = true
		await nextTick()

		expect(openSearch().allAccounts.value).toBe(true)
	})
})

describe('recent searches', () => {
	// Committed to, not typed: `rememberSearch` is what the palette calls when a result is
	// opened or the results page reached, so a test says so explicitly rather than typing.
	it('keeps the words as typed and the badges as applied, and says what it read as', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.setFilters({ inMailbox: 'mailbox-1' })

		search.rememberSearch()

		expect(search.recentSearches.value).toHaveLength(1)
		const [kept] = search.recentSearches.value
		expect(kept.text).toBe('budget')
		expect(kept.filters).toEqual({ inMailbox: 'mailbox-1' })
		expect(kept.label).toContain('budget')
		expect(kept.label).toContain('in:Inbox')
		expect(kept.resultType).toBe('mail-recent-search')
	})

	it('remembers nothing when nothing was asked', () => {
		const search = openSearch()
		search.query.value = '   '

		search.rememberSearch()

		expect(search.recentSearches.value).toEqual([])
	})

	it('moves a repeated search to the front rather than listing it twice', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.rememberSearch()
		search.query.value = 'invoice'
		search.rememberSearch()
		search.query.value = 'budget'
		search.rememberSearch()

		expect(search.recentSearches.value.map((entry) => entry.text)).toEqual(['budget', 'invoice'])
	})

	it('keeps only the last five', () => {
		const search = openSearch()
		for (const word of ['one', 'two', 'three', 'four', 'five', 'six']) {
			search.query.value = word
			search.rememberSearch()
		}

		expect(search.recentSearches.value.map((entry) => entry.text)).toEqual([
			'six',
			'five',
			'four',
			'three',
			'two',
		])
	})

	it('puts a remembered search back exactly as it ran', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.setFilters({ inMailbox: 'mailbox-1' })
		search.rememberSearch()
		search.query.value = ''
		search.setFilters({})

		search.restoreSearch(search.recentSearches.value[0])

		expect(search.query.value).toBe('budget')
		expect(search.filterValues.value).toEqual({ inMailbox: 'mailbox-1' })
	})

	it('puts a folder back only for the account it belongs to', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.search('budget', 'work')
		search.setFilters({ inMailbox: 'mailbox-1', isRead: 'false' })
		search.rememberSearch()
		search.query.value = ''
		search.setFilters({})

		// Another account: its folders are other folders, and this id names none of them.
		search.search('', 'personal')
		search.restoreSearch(search.recentSearches.value[0])
		expect(search.query.value).toBe('budget')
		expect(search.filterValues.value).toEqual({ isRead: 'false' })

		// Back on the account it ran against, the folder comes back with it.
		search.search('', 'work')
		search.restoreSearch(search.recentSearches.value[0])
		expect(search.filterValues.value).toEqual({ inMailbox: 'mailbox-1', isRead: 'false' })
	})

	it('is kept under the user, not the browser', async () => {
		document.cookie = 'user_id=alice@example.com'
		const alice = openSearch()
		alice.query.value = 'budget'
		alice.rememberSearch()
		await nextTick()

		document.cookie = 'user_id=bob@example.com'
		const bob = openSearch()
		expect(bob.recentSearches.value).toEqual([])
		expect(localStorage.getItem('mail-recent-searches:alice@example.com')).toContain('budget')
		document.cookie = 'user_id=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
	})

	it('forgets one and clears all', () => {
		const search = openSearch()
		search.query.value = 'budget'
		search.rememberSearch()
		search.query.value = 'invoice'
		search.rememberSearch()

		search.forgetSearch(search.recentSearches.value[1])
		expect(search.recentSearches.value.map((entry) => entry.text)).toEqual(['invoice'])

		search.clearRecentSearches()
		expect(search.recentSearches.value).toEqual([])
	})

	// The whole point: they are there the next time the page opens, which is a new composable.
	// After a tick, since `useStorage` writes the browser on the next flush rather than as the
	// ref is set — the way it would have long since done by the time a page is reopened.
	it('outlives the search that made it', async () => {
		const first = openSearch()
		first.query.value = 'budget'
		first.rememberSearch()
		await nextTick()

		const later = openSearch()

		expect(later.recentSearches.value.map((entry) => entry.text)).toEqual(['budget'])
	})
})
