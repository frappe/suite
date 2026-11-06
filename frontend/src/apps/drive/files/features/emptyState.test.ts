import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyState, emptyStateWithActions } from './emptyState'

// No company name: the organization root keeps its generic copy, and nothing asks the site.
beforeEach(() => {
  window.suite_workspace_name = ''
})

describe('empty states', () => {
  it('says a search found nothing, whatever the view', () => {
    expect(emptyState({ destination: 'folder', term: 'budget', canCreate: true })).toEqual({
      title: 'No files match this search',
      description: 'Try a different search term.',
    })
  })

  it('points to New only when the caller can add items', () => {
    expect(emptyState({ destination: 'folder', term: '', canCreate: true }).description).toContain(
      'Use New',
    )
    expect(
      emptyState({ destination: 'folder', term: '', canCreate: false }).description,
    ).not.toContain('New')
    expect(
      emptyState({ destination: 'shared', term: '', canCreate: false }).description,
    ).not.toMatch(/create|New/i)
  })

  it('gives each view its own copy', () => {
    const titles = (
      ['personal', 'organization', 'folder', 'shared', 'recent', 'starred', 'trash'] as const
    ).map((destination) => emptyState({ destination, term: '', canCreate: false }).title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('says an empty trashed folder was empty when it was trashed, with no hint to add items', () => {
    expect(
      emptyState({ destination: 'folder', term: '', canCreate: false, inTrash: true }),
    ).toEqual({
      title: 'This folder is empty',
      description: 'It was empty when it was moved to Trash.',
    })
  })

  it('names the type filter when nothing of that type is here', () => {
    expect(
      emptyState({ destination: 'recent', term: '', canCreate: false, typeNoun: 'images' }),
    ).toEqual({ title: 'No images here', description: 'Try another type, or clear the filter.' })
    expect(
      emptyState({ destination: 'folder', term: 'budget', canCreate: true, typeNoun: 'PDFs' })
        .title,
    ).toBe('No PDFs match this search')
  })

  it('states how long Trash keeps items', () => {
    expect(emptyState({ destination: 'trash', term: '', canCreate: false }).description).toContain(
      '30 days',
    )
  })

  it('names the company in an empty organization root', async () => {
    vi.resetModules()
    window.suite_workspace_name = 'Northwind Labs'
    const fresh = await import('./emptyState')
    expect(fresh.emptyState({ destination: 'organization', term: '', canCreate: false })).toEqual({
      title: 'No Northwind Labs files yet',
      description: 'Files added for Northwind Labs will appear here.',
    })
    delete window.suite_workspace_name
  })
})

describe('empty states with actions', () => {
  const state = (input: Partial<Parameters<typeof emptyStateWithActions>[0]> = {}) =>
    emptyStateWithActions({
      destination: 'folder',
      term: '',
      canCreate: false,
      canCreateDocuments: false,
      ...input,
    })

  it("shows the sidebar's icon for each view", () => {
    expect(
      (['folder', 'organization', 'shared', 'recent', 'starred', 'trash'] as const).map(
        (destination) => state({ destination }).icon,
      ),
    ).toEqual([
      'lucide-folder-open',
      'lucide-building-2',
      'lucide-users',
      'lucide-clock-3',
      'lucide-star',
      'lucide-trash-2',
    ])
  })

  it('mentions documents only where the caller can create them', () => {
    expect(state({ canCreate: true, canCreateDocuments: true }).description).toBe(
      'Use New to create a folder or a document.',
    )
    expect(state({ canCreate: true }).description).toBe('Use New to create a folder.')
    expect(state().description).toBe('Nothing has been added to this folder yet.')
  })

  it('names the search term of an empty search', () => {
    expect(state({ term: 'budget', canCreate: true })).toEqual({
      title: 'No results for “budget”',
      description: 'Try a different search term.',
      icon: 'lucide-search',
    })
  })

  it('keeps the type filter copy, with a filter icon', () => {
    expect(state({ term: 'budget', typeNoun: 'PDFs' })).toMatchObject({
      title: 'No PDFs match this search',
      icon: 'lucide-filter',
    })
  })
})
