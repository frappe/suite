import { describe, expect, it } from 'vitest'

import { buildListRows, stackKeyOf } from './threadStacks'

import type { Mail, Thread } from '@/apps/mail/types'

const message = (from_email: string, from_name = '') => ({ from_email, from_name }) as Mail

// A relay (Discourse, GitHub, Jira) gives every poster the same address and its own display name, so
// one notification thread names as many people as it had posters.
const post = (from_name: string, from_email = 'notifications@github.com') =>
	message(from_email, from_name)

const thread = (overrides: Partial<Thread> = {}): Thread =>
	({
		name: 'm1',
		account: 'acc1',
		thread_id: 't1',
		from_email: 'alerts@uptimerobot.com',
		from_name: 'UptimeRobot',
		messages: [message('alerts@uptimerobot.com', 'UptimeRobot')],
		subject: 'Monitor is UP: preview.frappe.cloud/',
		received_at: '2026-07-16 10:00:00',
		seen: 0,
		...overrides,
	}) as Thread

// A thread the user has answered: the bot still wrote first, but the latest sender is now the user.
const answered = (overrides: Partial<Thread> = {}) =>
	thread({
		from_email: 'vibhav@frappe.io',
		from_name: 'Vibhav Katre',
		messages: [message('alerts@uptimerobot.com'), message('vibhav@frappe.io', 'Vibhav Katre')],
		...overrides,
	})

// A run of adjacent threads that differ the way a real notification burst does: distinct ids, distinct
// times within the same day.
const run = (count: number, overrides: Partial<Thread> = {}) =>
	Array.from({ length: count }, (_, i) =>
		thread({
			name: `m${i}`,
			thread_id: `t${i}`,
			received_at: `2026-07-16 1${i}:00:00`,
			...overrides,
		}),
	)

const rowOptions = { rowKey: (t: Thread) => t.name, isExpanded: () => false }

describe('stackKeyOf', () => {
	it('ignores the subject entirely — one sender, one day, one pile', () => {
		expect(stackKeyOf(thread({ subject: 'Monitor is UP: preview.frappe.cloud/' }))).toBe(
			stackKeyOf(thread({ subject: 'Monitor is DOWN: preview.frappe.cloud/' })),
		)
		// Even wholly unrelated subjects from the same sender share a key: the accepted cost of the
		// sender rule, paid back by the count badge and one click to expand.
		expect(stackKeyOf(thread({ subject: '[PyPI] Unrecognized login to your PyPI account' }))).toBe(
			stackKeyOf(thread({ subject: '[PyPI] Trusted publisher created project frappectl' })),
		)
		expect(stackKeyOf(thread({ subject: null }))).toBe(stackKeyOf(thread({ subject: 'anything' })))
	})

	it('separates different senders', () => {
		expect(stackKeyOf(thread({ messages: [message('a@x.com')] }))).not.toBe(
			stackKeyOf(thread({ messages: [message('b@x.com')] })),
		)
	})

	it('returns null once a second address has written, so the thread never stacks', () => {
		// A thread with an answer in it is correspondence, not a flood — whoever wrote the answer.
		expect(stackKeyOf(answered())).toBeNull()
		const two = [message('alerts@uptimerobot.com'), message('neha@frappe.io')]
		expect(stackKeyOf(thread({ messages: two }))).toBeNull()
	})

	it('separates relay posters, who share an address but are different people', () => {
		// A mailing list rewrites the display name per original sender. Keying on the address alone
		// piled a whole digest under whichever member was newest.
		expect(stackKeyOf(thread({ messages: [post('Sarfaraz Shaikh')] }))).not.toBe(
			stackKeyOf(thread({ messages: [post('Neha Sankhe')] })),
		)
		// Several posters in ONE thread is no single writer either, so it never stacks.
		expect(
			stackKeyOf(thread({ messages: [post('Sarfaraz Shaikh'), post('M Umair Sayed')] })),
		).toBeNull()
		// Your own reply is a second address, and takes the thread out of the pile as it always did.
		expect(
			stackKeyOf(thread({ messages: [post('Jay1987'), message('vibhav@frappe.io', 'Vibhav')] })),
		).toBeNull()
	})

	it('treats a blank display name as absent, not as a second writer', () => {
		// Bots fill from_name on some messages and not others.
		expect(
			stackKeyOf(thread({ messages: [message('alerts@uptimerobot.com'), message('alerts@uptimerobot.com', 'UptimeRobot')] })),
		).toBe(stackKeyOf(thread()))
	})

	it('is case- and whitespace-insensitive about the sender', () => {
		expect(stackKeyOf(thread({ messages: [message('  Alerts@UptimeRobot.com ')] }))).toBe(
			stackKeyOf(thread({ messages: [message('alerts@uptimerobot.com')] })),
		)
	})

	it('falls back to the sender for rows with no thread behind them', () => {
		// Search results are single messages: no conversation, so the sender is all there is to key on.
		expect(stackKeyOf(thread({ messages: undefined, from_email: 'a@x.com' }))).not.toBe(
			stackKeyOf(thread({ messages: undefined, from_email: 'b@x.com' })),
		)
		expect(stackKeyOf(thread({ messages: undefined }))).toBe(stackKeyOf(thread()))
	})

	it('returns null without a sender, so such threads never stack', () => {
		expect(stackKeyOf(thread({ messages: [], from_email: '' }))).toBeNull()
	})

	it('separates the same sender across accounts', () => {
		expect(stackKeyOf(thread({ account: 'acc1' }))).not.toBe(
			stackKeyOf(thread({ account: 'acc2' })),
		)
	})

	it('separates the same sender across calendar days', () => {
		expect(stackKeyOf(thread({ received_at: '2026-07-16 23:59:00' }))).not.toBe(
			stackKeyOf(thread({ received_at: '2026-07-17 00:01:00' })),
		)
	})
})

describe('buildListRows', () => {
	it('leaves a run of two as ordinary rows', () => {
		expect(buildListRows(run(2), rowOptions).map((r) => r.type)).toEqual(['thread', 'thread'])
	})

	it('collapses a run of three into one stack', () => {
		const rows = buildListRows(run(3), rowOptions)
		expect(rows).toHaveLength(1)
		expect(rows[0].type).toBe('stack')
		expect(rows[0].type === 'stack' && rows[0].threads).toHaveLength(3)
	})

	it('collapses a flapping monitor regardless of the subjects', () => {
		const flap = ['UP', 'DOWN', 'UP', 'DOWN'].map((state, i) =>
			thread({ name: `m${i}`, subject: `Monitor is ${state}: preview.frappe.cloud/` }),
		)
		const rows = buildListRows(flap, rowOptions)
		expect(rows).toHaveLength(1)
		expect(rows[0].type === 'stack' && rows[0].threads).toHaveLength(4)
	})

	it('breaks a run at a different sender and preserves order', () => {
		const [a, b, c, d] = run(4)
		const other = thread({ name: 'other', messages: [message('hey@posthog.com')] })
		const rows = buildListRows([a, b, other, c, d], rowOptions)
		expect(rows.map((r) => r.type)).toEqual(['thread', 'thread', 'thread', 'thread', 'thread'])
		expect(rows.map((r) => r.key)).toEqual(['m0', 'm1', 'other', 'm2', 'm3'])
	})

	it('never stacks threads more than one address has written in, however alike they are', () => {
		// Same two people, same day, three in a row — still three conversations, never a pile.
		const conversations = run(3, {
			messages: [message('neha@frappe.io'), message('vibhav@frappe.io', 'Vibhav')],
		})
		expect(buildListRows(conversations, rowOptions).map((r) => r.type)).toEqual([
			'thread',
			'thread',
			'thread',
		])
	})

	it('collapses a run of relay threads from one poster', () => {
		const notifications = run(3, { messages: [post('Sarfaraz Shaikh')] })
		const rows = buildListRows(notifications, rowOptions)
		expect(rows).toHaveLength(1)
		expect(rows[0].type === 'stack' && rows[0].threads).toHaveLength(3)
	})

	it('leaves a mailing list alone when its posters differ', () => {
		// The Developers-list case: one address, a different writer each time. Three rows in, three
		// rows out — burying distinct people under one of their names is worse than a longer list.
		const digest = [
			thread({ name: 'm0', thread_id: 't0', messages: [post('Scaleway')] }),
			thread({ name: 'm1', thread_id: 't1', messages: [post('Twilio Notifications')] }),
			thread({ name: 'm2', thread_id: 't2', messages: [post('Oracle Support')] }),
		]
		const rows = buildListRows(digest, rowOptions)
		expect(rows).toHaveLength(3)
		expect(rows.every((r) => r.type === 'thread')).toBe(true)
	})

	it('breaks a run where the user has replied to one of its threads', () => {
		const [a, b, c] = run(3)
		const rows = buildListRows([a, b, answered({ name: 'replied' }), c], rowOptions)
		expect(rows.map((r) => r.type)).toEqual(['thread', 'thread', 'thread', 'thread'])
	})

	it('splits a run that crosses midnight into per-day stacks', () => {
		const day1 = run(3).map((t) => ({ ...t, received_at: '2026-07-16 10:00:00' }))
		const day2 = run(3).map((t, i) => ({ ...t, name: `n${i}`, received_at: '2026-07-17 10:00:00' }))
		expect(buildListRows([...day2, ...day1], rowOptions).map((r) => r.type)).toEqual([
			'stack',
			'stack',
		])
	})

	it('never merges senderless threads with each other', () => {
		const rows = buildListRows(run(3, { messages: [], from_email: '' }), rowOptions)
		expect(rows.map((r) => r.type)).toEqual(['thread', 'thread', 'thread'])
	})

	it('renders plain rows when disabled', () => {
		const rows = buildListRows(run(5), { ...rowOptions, enabled: false })
		expect(rows).toHaveLength(5)
		expect(rows.every((r) => r.type === 'thread')).toBe(true)
	})

	it('emits an expanded stack as a stack row followed by its members', () => {
		const rows = buildListRows(run(3), { ...rowOptions, isExpanded: () => true })
		expect(rows.map((r) => r.type)).toEqual(['stack', 'thread', 'thread', 'thread'])
		expect(rows[0].type === 'stack' && rows[0].expanded).toBe(true)
		// The members are marked so the list can indent them.
		expect(rows.slice(1).every((r) => r.type === 'thread' && r.inStack)).toBe(true)
	})

	it('marks only stack members as inStack, so ordinary rows are never indented', () => {
		const rows = buildListRows(run(2), rowOptions)
		expect(rows.every((r) => r.type === 'thread' && !r.inStack)).toBe(true)
	})

	it('detects runs that sit at either end of the list', () => {
		const other = thread({ name: 'other', messages: [message('hey@posthog.com')] })
		expect(buildListRows([...run(3), other], rowOptions).map((r) => r.type)).toEqual([
			'stack',
			'thread',
		])
		expect(buildListRows([other, ...run(3)], rowOptions).map((r) => r.type)).toEqual([
			'thread',
			'stack',
		])
	})
})
