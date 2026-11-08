import { translate as __ } from '@/platform/translation'

import { organizationName } from '../internal/locations'

export type FilesDestination =
  'personal' | 'organization' | 'folder' | 'shared' | 'recent' | 'starred' | 'trash'

export interface EmptyStateInput {
  destination: FilesDestination
  /** The trimmed search term, or empty when not searching. */
  term: string
  /** The caller can add items here, through the New menu. */
  canCreate: boolean
  /** The listing keeps one type of item, named as in a sentence, such as "images". */
  typeNoun?: string
  /** The folder is in Trash, so it keeps what it held when it was trashed. */
  inTrash?: boolean
  /** What to say where the caller can add items. */
  addHint?: string
}

export interface EmptyState {
  title: string
  description: string
  /** The icon class; the listing draws its own when there is none. */
  icon?: string
}

/** The sidebar's icon for each view, so an empty view looks like its entry. */
const DESTINATION_ICONS: Record<FilesDestination, string> = {
  personal: 'lucide-folder-open',
  organization: 'lucide-building-2',
  folder: 'lucide-folder-open',
  shared: 'lucide-users',
  recent: 'lucide-clock-3',
  starred: 'lucide-star',
  trash: 'lucide-trash-2',
}

/**
 * What an empty listing says when the page offers its actions:
 * an icon per view, and copy that matches the Upload files and Clear search buttons.
 */
export function emptyStateWithActions(
  input: EmptyStateInput & { canCreateDocuments: boolean },
): EmptyState {
  if (input.typeNoun) return { ...emptyState(input), icon: 'lucide-filter' }
  if (input.term)
    return {
      title: __('No results for “{0}”', [input.term]),
      description: __('Try a different search term.'),
      icon: 'lucide-search',
    }
  const addHint = input.canCreateDocuments
    ? __('Use New to create a folder or a document.')
    : __('Use New to create a folder.')
  return { ...emptyState({ ...input, addHint }), icon: DESTINATION_ICONS[input.destination] }
}

/** Days an item stays in Trash before the daily job deletes it (`suite.drive.jobs.purge_trashed_nodes`). */
const TRASH_RETENTION_DAYS = 30

/** What an empty listing says, per view. */
export function emptyState({
  destination,
  term,
  canCreate,
  typeNoun,
  inTrash,
  addHint: hint = 'Use New to add a folder, a document, or files.',
}: EmptyStateInput): EmptyState {
  // The page offers to clear the filter, so the copy names it.
  if (typeNoun) {
    return term
      ? {
          title: `No ${typeNoun} match this search`,
          description: 'Try a different search term, or clear the filter.',
        }
      : { title: `No ${typeNoun} here`, description: 'Try another type, or clear the filter.' }
  }
  if (term)
    return { title: 'No files match this search', description: 'Try a different search term.' }
  const addHint = canCreate ? hint : ''
  switch (destination) {
    case 'personal':
      return { title: 'No files yet', description: addHint || 'Files you add will appear here.' }
    case 'organization': {
      const company = organizationName()
      if (company)
        return {
          title: __('No {0} files yet', [company]),
          description: addHint || __('Files added for {0} will appear here.', [company]),
        }
      return {
        title: 'No organization files yet',
        description: addHint || 'Files added for your organization will appear here.',
      }
    }
    case 'folder':
      if (inTrash)
        return {
          title: 'This folder is empty',
          description: 'It was empty when it was moved to Trash.',
        }
      return {
        title: 'This folder is empty',
        description: addHint || 'Nothing has been added to this folder yet.',
      }
    case 'shared':
      return {
        title: 'Nothing shared with you yet',
        description: 'Files and folders that people share with you will appear here.',
      }
    case 'recent':
      return { title: 'No recent files', description: 'Files you open will appear here.' }
    case 'starred':
      return {
        title: 'No starred files',
        description: 'Star a file or folder to find it here quickly.',
      }
    case 'trash':
      return {
        title: 'Trash is empty',
        description: `Items you move to Trash stay here for ${TRASH_RETENTION_DAYS} days, then are deleted forever.`,
      }
  }
}
