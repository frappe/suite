import { afterEach, describe, expect, it, vi } from 'vitest'

import { noticeFor, othersPresentWarning, restoredByOther } from './restoreNotices'

const NAMES = new Map<string, string>(Object.entries({ 'amira@northwind.test': 'Amira Haddad' }))

vi.mock('@/platform/collab/names', () => ({
  lookUp: () => Promise.resolve(),
  fullName: (user: string) => NAMES.get(user) ?? user,
}))

describe('restoring under other people', () => {
  const me = 'me@northwind.test'

  it('warns about nobody when only this person has the document open', () => {
    const people = [{ id: me, name: 'Me' }]

    expect(othersPresentWarning(people, me, 'document')).toBe('')
  })

  it('names each other person once, even with the document open in two of their tabs', () => {
    const people = [
      { id: me, name: 'Me' },
      { id: 'amira@northwind.test', name: 'Amira Haddad' },
      { id: 'amira@northwind.test', name: 'Amira Haddad' },
      { id: 'ben@northwind.test', name: 'Ben Ito' },
    ]

    expect(othersPresentWarning(people, me, 'document')).toBe(
      'Amira Haddad and Ben Ito have this document open now and will be told you restored it.',
    )
  })

  it('names one other person in the singular', () => {
    const people = [{ id: 'amira@northwind.test', name: 'Amira Haddad' }]

    expect(othersPresentWarning(people, me, 'document')).toBe(
      'Amira Haddad has this document open now and will be told you restored it.',
    )
  })
})

describe('told about another person’s restore', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('names who restored a named version, and the name', async () => {
    const restored = {
      by: 'amira@northwind.test',
      version: { seq: 3, label: 'Draft for review', takenAt: '2026-10-22T05:12:00+00:00' },
    }

    expect(await restoredByOther(restored, 'document')).toBe(
      'Amira Haddad restored the version “Draft for review”.',
    )
  })

  it('names an automatic version by its time today, and by its day before today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 22, 18, 0))
    const today = new Date(2026, 9, 22, 10, 42).toISOString()
    const earlier = new Date(2026, 9, 12, 10, 42).toISOString()
    const restored = (takenAt: string) => ({
      by: 'amira@northwind.test',
      version: { seq: 3, label: null, takenAt },
    })

    expect(await restoredByOther(restored(today), 'document')).toMatch(
      /^Amira Haddad restored the version from 10:42\sAM\.$/,
    )
    expect(await restoredByOther(restored(earlier), 'document')).toMatch(
      /^Amira Haddad restored the version from (Oct 12|12 Oct), 10:42\sAM\.$/,
    )
  })

  it('still tells the reader when the notice names no person or no version', async () => {
    expect(await restoredByOther({ by: null, version: null }, 'document')).toBe(
      'Someone restored an earlier version of this document.',
    )
  })
})

describe('restore messages for a presentation', () => {
  const me = 'me@northwind.test'

  it('names the presentation when others have it open', () => {
    const one = [{ id: 'amira@northwind.test', name: 'Amira Haddad' }]
    const two = [...one, { id: 'ben@northwind.test', name: 'Ben Ito' }]

    expect([
      othersPresentWarning(one, me, 'presentation'),
      othersPresentWarning(two, me, 'presentation'),
    ]).toEqual([
      'Amira Haddad has this presentation open now and will be told you restored it.',
      'Amira Haddad and Ben Ito have this presentation open now and will be told you restored it.',
    ])
  })

  it('names the presentation when a restore changed nothing or could not keep it first', () => {
    expect([
      noticeFor({ outcome: 'unchanged' }, 'presentation').message,
      noticeFor({ outcome: 'refused', refusal: 'milestone_failed' }, 'presentation').message,
    ]).toEqual([
      'The presentation already matches this version.',
      "The presentation as it is now couldn't be kept as a version first, so nothing was restored.",
    ])
  })

  it('names the presentation when another person’s restore names no version', async () => {
    expect(await restoredByOther({ by: null, version: null }, 'presentation')).toBe(
      'Someone restored an earlier version of this presentation.',
    )
  })
})
