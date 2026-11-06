import { describe, expect, it } from 'vitest'

import {
  activeDatePreset,
  datePresetStart,
  hasSearchConditions,
  searchWords,
  toggledFilter,
  withAllAccounts,
  withEditedLine,
  withFilter,
  withoutFilters,
} from './searchFilters'

describe('editing a search', () => {
  it('sets a filter, and takes it off when it has no value', () => {
    expect(withFilter({ text: 'a' }, 'from', 'ana@x')).toEqual({ text: 'a', from: 'ana@x' })
    expect(withFilter({ text: 'a', from: 'ana@x' }, 'from', '')).toEqual({ text: 'a' })
  })

  it('turns a choice off by choosing it again, and flips it by choosing the other', () => {
    expect(toggledFilter({}, 'isRead', 'false')).toEqual({ isRead: 'false' })
    expect(toggledFilter({ isRead: 'false' }, 'isRead', 'false')).toEqual({})
    expect(toggledFilter({ isRead: 'true' }, 'isRead', 'false')).toEqual({ isRead: 'false' })
  })

  it('clearing filters keeps the words and where they are looked for', () => {
    expect(
      withoutFilters({ text: 'a', from: 'x', after: '2026-01-01', all_accounts: '1' }),
    ).toEqual({ text: 'a', all_accounts: '1' })
  })

  it('widening to every account drops the folder, which only means something in one', () => {
    expect(withAllAccounts({ text: 'a', inMailbox: 'b' }, true)).toEqual({
      text: 'a',
      all_accounts: '1',
    })
    expect(withAllAccounts({ text: 'a', all_accounts: '1' }, false)).toEqual({ text: 'a' })
  })

  it('a scope alone is not a search', () => {
    expect(hasSearchConditions({ all_accounts: '1' })).toBe(false)
    expect(hasSearchConditions({ all_accounts: '1', from: 'x' })).toBe(true)
  })
})

describe('the query line', () => {
  it('turns typed operators into filters and leaves the rest of the search alone', () => {
    expect(withEditedLine({ text: 'old', isRead: 'false' }, 'budget from:ana@x')).toEqual({
      text: 'budget',
      from: 'ana@x',
      isRead: 'false',
    })
  })

  it('an emptied line drops the words and keeps the filters', () => {
    expect(withEditedLine({ text: 'old', from: 'ana@x' }, '  ')).toEqual({ from: 'ana@x' })
  })

  it('keeps a quoted phrase whole', () => {
    expect(withEditedLine({}, '"board meeting" notes')).toEqual({
      text: '"board meeting" notes',
    })
  })
})

describe('date presets', () => {
  const today = new Date(2026, 10, 5)

  it('count back from today', () => {
    expect(datePresetStart('week', today)).toBe('2026-10-29')
    expect(datePresetStart('month', today)).toBe('2026-10-05')
    expect(datePresetStart('quarter', today)).toBe('2026-08-05')
    expect(datePresetStart('year', today)).toBe('2025-11-05')
  })

  it('are recognised from the route, and a custom range is none of them', () => {
    expect(activeDatePreset({ after: '2026-10-29' }, today)).toBe('week')
    expect(activeDatePreset({ after: '2026-10-29', before: '2026-11-01' }, today)).toBeUndefined()
    expect(activeDatePreset({ after: '2026-10-28' }, today)).toBeUndefined()
  })
})

describe('the words to mark', () => {
  it('holds what the server marked and what was typed, without a phrase quotes', () => {
    expect(searchWords('"board meeting"', ['Boards'])).toBe('Boards  board meeting')
  })

  it('is empty for a search with no words', () => {
    expect(searchWords(undefined, [])).toBe('')
  })
})
