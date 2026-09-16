import { describe, expect, it } from 'vitest'
import { resolvePresentation } from './presentation'

describe('presentation state', () => {
  it('uses query over preference over defaults', () => {
    const saved = { view: 'grid' as const, sort: 'modified' as const, dir: 'desc' as const, group: 'owner' as const }
    expect(resolvePresentation({ view: 'list', sort: 'owner' }, saved)).toMatchObject({
      view: 'list', sort: 'owner', dir: 'desc', group: 'owner',
    })
    expect(resolvePresentation({}, saved)).toMatchObject(saved)
    expect(resolvePresentation({}, null)).toMatchObject({ view: 'list', sort: 'title', dir: 'asc', group: 'none' })
  })
})

