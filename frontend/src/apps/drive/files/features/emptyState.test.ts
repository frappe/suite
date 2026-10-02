import { describe, expect, it } from 'vitest'
import { emptyState } from './emptyState'

describe('empty states', () => {
  it('says a search found nothing, whatever the view', () => {
    expect(emptyState({ destination: 'folder', term: 'budget', canCreate: true })).toEqual({
      title: 'No files match this search',
      description: 'Try a different search term.',
    })
  })

  it('points to New only when the caller can add items', () => {
    expect(emptyState({ destination: 'folder', term: '', canCreate: true }).description).toContain('Use New')
    expect(emptyState({ destination: 'folder', term: '', canCreate: false }).description).not.toContain('New')
    expect(emptyState({ destination: 'shared', term: '', canCreate: false }).description).not.toMatch(/create|New/i)
  })

  it('gives each view its own copy', () => {
    const titles = (['personal', 'organization', 'folder', 'shared', 'recent', 'starred', 'trash'] as const)
      .map((destination) => emptyState({ destination, term: '', canCreate: false }).title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('names the type filter when nothing of that type is here', () => {
    expect(emptyState({ destination: 'recent', term: '', canCreate: false, typeNoun: 'images' }))
      .toEqual({ title: 'No images here', description: 'Try another type, or clear the filter.' })
    expect(emptyState({ destination: 'folder', term: 'budget', canCreate: true, typeNoun: 'PDFs' }).title)
      .toBe('No PDFs match this search')
  })

  it('states how long Trash keeps items', () => {
    expect(emptyState({ destination: 'trash', term: '', canCreate: false }).description).toContain('30 days')
  })
})
