import { describe, expect, it } from 'vitest'

import { isCollapsed, lastMessageOf } from './threadFolding'

import type { Mail } from '@/apps/mail/types'

// Every mail arrives seen, and so collapsed, the way a reloaded thread hands them over.
const mail = (name: string, overrides: Partial<Mail> = {}) =>
	({ name, draft: 0, seen: 1, collapsed: true, ...overrides }) as Mail

const draft = (name: string) => mail(name, { draft: 1 })

const folded = (thread: Mail[]) => {
	const last = lastMessageOf(thread)
	return thread.map((m) => isCollapsed(m, last))
}

describe('lastMessageOf', () => {
	it('is the newest mail that is not a draft', () => {
		const thread = [mail('a'), mail('b'), draft('reply')]
		expect(lastMessageOf(thread)).toBe(thread[1])
	})

	it('is the draft itself when the draft is all there is', () => {
		const thread = [draft('new')]
		expect(lastMessageOf(thread)).toBe(thread[0])
	})
})

describe('isCollapsed', () => {
	it('keeps the message being read open and folds the seen mail above it', () => {
		expect(folded([mail('a'), mail('b'), mail('c')])).toEqual([true, true, false])
	})

	it('leaves an unseen mail open wherever it sits', () => {
		expect(folded([mail('a', { collapsed: false }), mail('b')])).toEqual([false, false])
	})

	it('never folds a reply draft, and the mail it answers stays open under it', () => {
		expect(folded([mail('a'), mail('b'), draft('reply')])).toEqual([true, false, false])
	})

	it('never folds a draft that is the whole thread', () => {
		expect(folded([draft('new')])).toEqual([false])
	})
})
