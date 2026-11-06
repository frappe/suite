import { afterEach, describe, expect, it } from 'vitest'

import { setTweaks } from '@/platform/tweaks'

import {
  nextSort,
  resolvePresentation,
  writeColumnChoice,
  writePresentationPreference,
} from './presentation'

describe('presentation state', () => {
  it('uses query over preference over defaults', () => {
    const saved = { view: 'grid' as const, sort: 'modified' as const, dir: 'desc' as const }
    expect(resolvePresentation({ view: 'list', sort: 'owner' }, saved)).toMatchObject({
      view: 'list',
      sort: 'owner',
      dir: 'desc',
    })
    expect(resolvePresentation({}, saved)).toMatchObject(saved)
    expect(resolvePresentation({}, null)).toMatchObject({ view: 'list', sort: 'title', dir: 'asc' })
  })

  it('ignores the grouping an old link or saved preference still carries', () => {
    const oldPreference = JSON.parse(
      '{"view":"grid","sort":"title","dir":"asc","group":"owner","columns":["owner"]}',
    )
    expect(resolvePresentation({ group: 'type' }, oldPreference)).toEqual({
      view: 'grid',
      sort: 'title',
      dir: 'asc',
      columns: ['owner'],
    })
  })

  describe('columns', () => {
    afterEach(() => {
      localStorage.clear()
      setTweaks(['t35-default-columns'], true)
    })

    const shown = () => resolvePresentation({}).columns

    it('shows Modified, Type and Size to a user who never chose columns', () => {
      expect(shown()).toEqual(['owner', 'modified', 'kind', 'size'])

      // Changing the view or the sort is not a column choice.
      writePresentationPreference({ view: 'grid', sort: 'size', dir: 'desc' })
      expect(shown()).toEqual(['owner', 'modified', 'kind', 'size'])
    })

    it('keeps a column the user turned off, and the defaults of the others', () => {
      writeColumnChoice(shown(), 'kind', false)
      expect(shown()).toEqual(['owner', 'modified', 'size'])

      writePresentationPreference({ view: 'grid' })
      expect(shown()).toEqual(['owner', 'modified', 'size'])
    })

    it('reads a preference saved before the new defaults', () => {
      writePresentationPreference({ columns: ['owner', 'modified'] })
      expect(shown()).toEqual(['owner', 'modified', 'kind', 'size'])

      localStorage.clear()
      writePresentationPreference({ columns: ['modified', 'size'] })
      expect(shown()).toEqual(['modified', 'size'])
    })

    it('shows Owner and Modified only, with the tweak off', () => {
      setTweaks(['t35-default-columns'], false)
      expect(shown()).toEqual(['owner', 'modified'])

      writeColumnChoice(shown(), 'size', true)
      expect(shown()).toEqual(['owner', 'modified', 'size'])
    })
  })

  it('starts a new field in its natural order, and flips the same field', () => {
    const byName = { sort: 'title', dir: 'asc' } as const
    expect(nextSort(byName, 'modified')).toEqual({ sort: 'modified', dir: 'desc' })
    expect(nextSort(byName, 'size')).toEqual({ sort: 'size', dir: 'desc' })
    expect(nextSort({ sort: 'modified', dir: 'desc' }, 'modified')).toEqual({
      sort: 'modified',
      dir: 'asc',
    })
    expect(nextSort({ sort: 'size', dir: 'desc' }, 'title')).toEqual({ sort: 'title', dir: 'asc' })
    expect(nextSort(byName, 'title')).toEqual({ sort: 'title', dir: 'desc' })
  })
})
