import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'

import type { Mail } from '@/apps/mail/types'

import {
  arrivalsIn,
  foldedNames,
  holdNewestOpen,
  isCollapsed,
  lastMessageOf,
  stillFolded,
  withEarlier,
} from './threadFolding'

// Every mail arrives seen, and so collapsed, the way a reloaded thread hands them over.
const mail = (name: string, overrides: Partial<Mail> = {}) =>
  fromPartial<Mail>({ name, draft: 0, seen: 1, collapsed: true, ...overrides })

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

describe('a long thread, read in part', () => {
  const at = (name: string, overrides: Partial<Mail> = {}) =>
    mail(name, { id: name, received_at: `2026-10-01T09:00:${name.slice(1)}Z`, ...overrides })

  it('puts a page ahead of the mail it was asked for, and its oldest says what is left', () => {
    const before = at('m40', { earlier_unloaded: 39 })
    const page = [at('m38', { earlier_unloaded: 37 }), at('m39')]
    const thread = withEarlier([at('m00'), before, at('m41')], before, page, page)
    expect(thread.map((m) => [m.name, m.earlier_unloaded ?? 0])).toEqual([
      ['m00', 0],
      ['m38', 37],
      ['m39', 0],
      ['m40', 0],
      ['m41', 0],
    ])
  })

  it('asks for the next page from the oldest mail fetched when the pane shows none of the page', () => {
    // Every mail of the page is in Trash, which this view leaves out.
    const before = at('m40', { earlier_unloaded: 39 })
    const page = [at('m38', { earlier_unloaded: 37 }), at('m39')]
    const thread = withEarlier([at('m00'), before], before, page, [])
    expect(thread.map((m) => m.name)).toEqual(['m00', 'm40'])
    expect(before).toMatchObject({ earlier_unloaded: 37, earlier_from: 'm38' })
  })

  it('leaves out mail the thread already holds', () => {
    const first = at('m00')
    const before = at('m02', { earlier_unloaded: 1 })
    const thread = withEarlier(
      [first, before],
      before,
      [at('m00'), at('m01')],
      [at('m00'), at('m01')],
    )
    expect(thread.map((m) => m.name)).toEqual(['m00', 'm01', 'm02'])
  })

  it('takes a reply from a fuller part of the thread, and not the older mail that comes with it', () => {
    // The pane opened on a list row; the thread fetched on its own brings more of its newest mail.
    const held = [at('m00'), at('m98', { earlier_unloaded: 97 }), at('m99')]
    const fetched = [
      at('m00'),
      at('m96', { earlier_unloaded: 95 }),
      at('m97'),
      at('m98'),
      at('m99'),
    ]
    const reply = at('m100')
    expect(arrivalsIn([...fetched, reply], held)).toEqual([reply])
    expect(reply.earlier_unloaded).toBe(0)
  })

  it('says how many arrivals the fresh part of the thread left out', () => {
    const held = [at('m00'), at('m98', { earlier_unloaded: 97 }), at('m99')]
    const row = [at('m00'), at('m103', { earlier_unloaded: 102 }), at('m104')]
    expect(arrivalsIn(row, held).map((m) => [m.name, m.earlier_unloaded])).toEqual([
      ['m103', 3],
      ['m104', 0],
    ])
  })

  it('says nothing is ahead of an arrival when the pane holds a message it does not show', () => {
    // The pane loaded the whole thread but m50, trashed and so not shown; m100 has just come in.
    const held = Array.from({ length: 100 }, (_, n) => at(`m${String(n).padStart(2, '0')}`)).filter(
      (m) => m.name !== 'm50',
    )
    const row = [at('m00'), at('m99', { earlier_unloaded: 98 }), at('m100')]
    expect(arrivalsIn(row, held).map((m) => [m.name, m.earlier_unloaded])).toEqual([['m100', 0]])
  })
})
