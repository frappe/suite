import { describe, expect, it } from 'vitest'

import {
  fromTokens,
  labelFor,
  mentionQuery,
  pickedIn,
  toParts,
  toTokens,
  type PickedPerson,
} from './commentMentions'

const ANN = { user: 'ann@x.com', label: 'Ann Lee' }
const ANNA = { user: 'anna@x.com', label: 'Ann' }

describe('the person being looked for after @', () => {
  it('reads the word after an @ that starts a word, up to the caret', () => {
    const found = [
      mentionQuery('@', 1),
      mentionQuery('hi @an', 6),
      mentionQuery('hi (@an) there', 7),
      mentionQuery('@ann and more', 3),
    ]

    expect(found).toEqual([
      { query: '', start: 0 },
      { query: 'an', start: 3 },
      { query: 'an', start: 4 },
      { query: 'an', start: 0 },
    ])
  })

  it('looks for no one in an email, after a space, or past the caret', () => {
    const found = [
      mentionQuery('mail ann@x.com', 14),
      mentionQuery('@ann lee', 8),
      mentionQuery('hi @an', 2),
      mentionQuery('hi', 2),
    ]

    expect(found).toEqual([null, null, null, null])
  })
})

describe('the names a box shows for the people picked in it', () => {
  it('names a person by their name, and by user id when someone picked shares it or it is blank', () => {
    const labels = [
      labelFor('ann@x.com', ' Ann Lee ', []),
      labelFor('ann2@x.com', 'Ann Lee', [ANN]),
      labelFor('ann@x.com', 'Someone else', [ANN]),
      labelFor('ben@x.com', '', [ANN]),
    ]

    expect(labels).toEqual(['Ann Lee', 'ann2@x.com', 'Ann Lee', 'ben@x.com'])
  })

  it('reads the people a stored text mentions, with names that tell them apart', () => {
    const names: Record<string, string> = { 'ann@x.com': 'Ann Lee', 'ann2@x.com': 'Ann Lee' }

    const picked = pickedIn('@[ann@x.com] and @[ann2@x.com], @[ann@x.com]', (user) => names[user]!)

    expect(picked).toEqual([ANN, { user: 'ann2@x.com', label: 'ann2@x.com' }, ANN])
  })

  it('reads every mention of a stored text when there is no list of the people it mentions', () => {
    const picked = pickedIn('Ask @[BEN@x.com] or @[ghost]', (user) => `name of ${user}`)

    expect(picked).toEqual([
      { user: 'BEN@x.com', label: 'name of BEN@x.com' },
      { user: 'ghost', label: 'name of ghost' },
    ])
  })

  it('names a listed person whatever the case of their mention, and keeps the mention as stored', () => {
    const stored = 'Ask @[BEN@x.com] or @[ghost]'
    const names: Record<string, string> = { 'ben@x.com': 'Ben Roy' }

    const picked = pickedIn(stored, (user) => names[user] ?? user, ['ben@x.com'])
    const shown = fromTokens(stored, picked)

    expect([picked, shown, toTokens(shown, picked)]).toEqual([
      [{ user: 'BEN@x.com', label: 'Ben Roy' }],
      'Ask @Ben Roy or @[ghost]',
      stored,
    ])
  })
})

describe('turning names into mentions and back', () => {
  const picked: PickedPerson[] = [ANNA, ANN, { user: 'ann2@x.com', label: 'ann2@x.com' }]

  it('writes each whole picked name as its person’s mention, the longest name first', () => {
    const stored = toTokens(
      '@Ann Lee and @Ann, (@ann2@x.com) hi,@Ann Lee@Ann. @Ann Leeds @Ben Roy @Annie',
      picked,
    )

    expect(stored).toBe(
      '@[ann@x.com] and @[anna@x.com], (@[ann2@x.com]) hi,@[ann@x.com]@[anna@x.com]. @[anna@x.com] Leeds @Ben Roy @Annie',
    )
  })

  it('leaves text with no picked people as it is, special characters and all', () => {
    expect([
      toTokens('@Ann Lee (a+b)', []),
      toTokens('@a.b', [{ user: 'x', label: 'a+b' }]),
    ]).toEqual(['@Ann Lee (a+b)', '@a.b'])
  })

  it('shows each picked person’s mention by name, and leaves mentions of anyone else', () => {
    const shown = fromTokens('@[ann@x.com] and @[ben@x.com] and @[ann2@x.com]', picked)

    expect(shown).toBe('@Ann Lee and @[ben@x.com] and @ann2@x.com')
  })

  it('gives back the stored text after showing it and writing it again', () => {
    const stored = 'hi,@[ann@x.com] and @[ann2@x.com]\n(@[anna@x.com]) @[ben@x.com]'
    const names: Record<string, string> = { 'ann@x.com': 'Ann Lee', 'ann2@x.com': 'Ann Lee' }
    const again = pickedIn(stored, (user) => names[user] ?? 'Ann')

    expect(toTokens(fromTokens(stored, again), again)).toBe(stored)
  })
})

describe('the parts a comment shows', () => {
  it('splits the text around the people Drive found mentioned', () => {
    const parts = toParts('@[ann@x.com] meet @[ghost] and @[ben@x.com]!', [
      'ann@x.com',
      'ben@x.com',
    ])

    expect(parts).toEqual([
      { text: '@[ann@x.com]', user: 'ann@x.com' },
      { text: ' meet @[ghost] and ', user: null },
      { text: '@[ben@x.com]', user: 'ben@x.com' },
      { text: '!', user: null },
    ])
  })

  it('takes every mention in the text when Drive has not read it yet, and plain text whole', () => {
    expect([toParts('hi @[ghost]'), toParts('plain'), toParts('')]).toEqual([
      [
        { text: 'hi ', user: null },
        { text: '@[ghost]', user: 'ghost' },
      ],
      [{ text: 'plain', user: null }],
      [],
    ])
  })
})
