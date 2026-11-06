import { describe, expect, it } from 'vitest'

import { nextSort, resolvePresentation } from './presentation'

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
