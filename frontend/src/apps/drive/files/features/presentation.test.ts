import { describe, expect, it } from 'vitest'
import { resolvePresentation } from './presentation'

describe('presentation state', () => {
  it('uses query over preference over defaults', () => {
    const saved = { view: 'grid' as const, sort: 'modified' as const, dir: 'desc' as const }
    expect(resolvePresentation({ view: 'list', sort: 'owner' }, saved)).toMatchObject({
      view: 'list', sort: 'owner', dir: 'desc',
    })
    expect(resolvePresentation({}, saved)).toMatchObject(saved)
    expect(resolvePresentation({}, null)).toMatchObject({ view: 'list', sort: 'title', dir: 'asc' })
  })

  it('ignores the grouping an old link or saved preference still carries', () => {
    const oldPreference = JSON.parse('{"view":"grid","sort":"title","dir":"asc","group":"owner","columns":["owner"]}')
    expect(resolvePresentation({ group: 'type' }, oldPreference)).toEqual({
      view: 'grid', sort: 'title', dir: 'asc', columns: ['owner'],
    })
  })
})
