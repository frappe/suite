import { describe, expect, it } from 'vitest'

import type { Mail } from '@/apps/mail/types'

import {
  foldedNames,
  holdNewestOpen,
  isCollapsed,
  lastMessageOf,
  stillFolded,
} from './threadFolding'

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

describe('foldedNames', () => {
  const names = (...list: string[]) => list.map((name) => mail(name))

  it('folds the seen mail between the first and the two newest', () => {
    expect(foldedNames(names('a', 'b', 'c', 'd', 'e', 'f'))).toEqual(['b', 'c', 'd'])
  })

  it('folds nothing in a short thread', () => {
    expect(foldedNames(names('a', 'b', 'c', 'd'))).toEqual([])
  })

  it('folds nothing more when a reply draft is opened under the last message', () => {
    const thread = names('a', 'b', 'c', 'd', 'e', 'f')
    expect(foldedNames([...thread, draft('reply')])).toEqual(['b', 'c', 'd'])
  })

  it('folds nothing more for a draft opened under an earlier message', () => {
    const [a, b, c, d, e, f] = names('a', 'b', 'c', 'd', 'e', 'f')
    expect(foldedNames([a, b, c, d, e, draft('reply'), f])).toEqual(['b', 'c', 'd'])
  })

  it('never folds unseen mail', () => {
    const thread = [...names('a', 'b', 'c', 'd', 'e'), mail('new', { seen: 0 })]
    expect(foldedNames(thread)).toEqual(['b', 'c', 'd'])
  })
})

describe('mail arriving in an open thread', () => {
  const names = (...list: string[]) => list.map((name) => mail(name))
  const arrival = (name: string) => mail(name, { seen: 0, collapsed: false })
  const hidden = (fold: string[], thread: Mail[]) => [...stillFolded(fold, thread)]

  it('keeps the message being read open under the new mail', () => {
    const thread = names('a', 'b', 'c')
    holdNewestOpen(thread)
    thread.push(arrival('d'))
    expect(folded(thread)).toEqual([true, true, false, false])
  })

  it('keeps hiding what the fold hid, and nothing more', () => {
    const thread = names('a', 'b', 'c', 'd', 'e', 'f')
    const fold = foldedNames(thread)
    expect(hidden(fold, [...thread, arrival('g')])).toEqual(['b', 'c', 'd'])
  })

  it('stays open once the reader has opened it', () => {
    const thread = names('a', 'b', 'c', 'd', 'e', 'f')
    expect(hidden([], [...thread, arrival('g')])).toEqual([])
  })

  it('shows the newest replies left when the ones under them go', () => {
    const [a, b, c, d, e, f] = names('a', 'b', 'c', 'd', 'e', 'f')
    const fold = foldedNames([a, b, c, d, e, f])
    expect(hidden(fold, [a, b, c, d])).toEqual(['b'])
  })

  it('gives back mail marked unread, and forgets mail that has gone', () => {
    const [a, b, c, d, e, f] = names('a', 'b', 'c', 'd', 'e', 'f')
    const fold = foldedNames([a, b, c, d, e, f])
    c.seen = 0
    expect(hidden(fold, [a, b, c, e, f])).toEqual(['b'])
  })
})
