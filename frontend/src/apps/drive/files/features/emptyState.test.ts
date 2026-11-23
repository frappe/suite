import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspace } from '@/platform/workspace'

import { emptyState, type EmptyStateInput } from './emptyState'

const nameWorkspace = (workspace_name: string) =>
  useWorkspace().setWorkspace({ workspace_name, workspace_logo: '' })

// No company name: the organization root keeps its generic copy.
beforeEach(() => nameWorkspace(''))

const state = (input: Partial<EmptyStateInput> = {}) =>
  emptyState({
    destination: 'folder',
    term: '',
    canCreate: false,
    canCreateDocuments: false,
    ...input,
  })

describe('empty states', () => {
  it('names the search term of an empty search, whatever the view', () => {
    expect(state({ term: 'budget', canCreate: true })).toEqual({
      title: 'No results for “budget”',
      description: 'Try a different search term.',
      icon: 'lucide-search',
    })
  })

  it('gives each view its own copy', () => {
    const titles = (
      ['personal', 'organization', 'folder', 'shared', 'recent', 'starred', 'trash'] as const
    ).map((destination) => state({ destination }).title)
    expect(new Set(titles).size).toBe(titles.length)
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

  it('points to New only where the caller can add items, and mentions documents only where they can create them', () => {
    expect(state({ canCreate: true, canCreateDocuments: true }).description).toBe(
      'Use New to create a folder or a document.',
    )
    expect(state({ canCreate: true }).description).toBe('Use New to create a folder.')
    expect(state().description).toBe('Nothing has been added to this folder yet.')
    expect(state({ destination: 'shared' }).description).not.toMatch(/create|New/i)
  })

  it('says an empty trashed folder was empty when it was trashed, with no hint to add items', () => {
    expect(state({ inTrash: true })).toMatchObject({
      title: 'This folder is empty',
      description: 'It was empty when it was moved to Trash.',
    })
  })

  it('names the type filter when nothing of that type is here', () => {
    expect(state({ destination: 'recent', typeNoun: 'images' })).toEqual({
      title: 'No images here',
      description: 'Try another type, or clear the filter.',
      icon: 'lucide-filter',
    })
    expect(state({ term: 'budget', canCreate: true, typeNoun: 'PDFs' })).toMatchObject({
      title: 'No PDFs match this search',
      icon: 'lucide-filter',
    })
  })

  it('states how long Trash keeps items', () => {
    expect(state({ destination: 'trash' }).description).toContain('30 days')
  })

  it('names the company in an empty organization root', () => {
    nameWorkspace('Northwind Labs')
    expect(state({ destination: 'organization' })).toMatchObject({
      title: 'No Northwind Labs files yet',
      description: 'Files added for Northwind Labs will appear here.',
    })
  })
})
