import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

import type { Thread } from '@/apps/mail/types'

import { selectActions, type SelectHandlers } from './selectActions'

const handlers = () =>
  fromPartial<SelectHandlers>(
    Object.fromEntries(
      [
        'star',
        'unstar',
        'archive',
        'junk',
        'notJunk',
        'trash',
        'delete',
        'read',
        'unread',
        'pin',
        'unpin',
      ].map((name) => [name, vi.fn()]),
    ),
  )

const offered = (rows: Partial<Thread>[], inbox: boolean) =>
  selectActions(
    () => rows.map((row) => fromPartial<Thread>({ messages: [], mailboxes: [], ...row })),
    () => ({ archive: false, trash: false, drafts: false, inbox }),
    handlers(),
  )
    .filter((action) => action.condition())
    .map((action) => action.shortLabel)

describe('pinning a selection', () => {
  it('offers Pin for unpinned rows and Unpin for pinned ones in an Inbox', () => {
    expect(offered([{ pinned: 0 }], true)).toContain('Pin')
    expect(offered([{ pinned: 0 }], true)).not.toContain('Unpin')
    expect(offered([{ pinned: 1 }], true)).toContain('Unpin')
    expect(offered([{ pinned: 1 }], true)).not.toContain('Pin')
  })

  it('offers both on a mixed selection', () => {
    const labels = offered([{ pinned: 0 }, { pinned: 1 }], true)
    expect(labels).toEqual(expect.arrayContaining(['Pin', 'Unpin']))
  })

  it('offers neither outside an Inbox, where a pin does nothing', () => {
    const labels = offered([{ pinned: 0 }, { pinned: 1 }], false)
    expect(labels).not.toContain('Pin')
    expect(labels).not.toContain('Unpin')
  })
})

const inList = (rows: Partial<Thread>[], folder: { snoozable?: boolean; snoozed?: boolean }) =>
  selectActions(
    () => rows.map((row) => fromPartial<Thread>({ messages: [], mailboxes: [], ...row })),
    () => ({ archive: false, trash: false, drafts: false, ...folder }),
    handlers(),
  )
    .filter((action) => action.condition())
    .map((action) => action.shortLabel)

describe('snoozing a selection', () => {
  it('offers Snooze where it can be snoozed from, and nothing to bring back', () => {
    const labels = inList([{}], { snoozable: true })
    expect(labels).toContain('Snooze')
    expect(labels).not.toContain('Unsnooze')
  })

  it('offers both in Snoozed: another time, or back now', () => {
    expect(inList([{}], { snoozed: true })).toEqual(expect.arrayContaining(['Snooze', 'Unsnooze']))
  })

  it('offers neither in a list it does not act on', () => {
    const labels = inList([{}], {})
    expect(labels).not.toContain('Snooze')
    expect(labels).not.toContain('Unsnooze')
  })
})
