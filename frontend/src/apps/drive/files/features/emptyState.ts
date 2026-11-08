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
  /** The New menu offers documents here, not only folders. */
  canCreateDocuments: boolean
  /** The listing keeps one type of item, named as in a sentence, such as "images". */
  typeNoun?: string
  /** The folder is in Trash, so it keeps what it held when it was trashed. */
  inTrash?: boolean
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

/** Days an item stays in Trash before the daily job deletes it (`suite.drive.jobs.purge_trashed_nodes`). */
const TRASH_RETENTION_DAYS = 30

/** What an empty listing says, with copy that matches the Upload files and Clear search buttons. */
export function emptyState(input: EmptyStateInput): EmptyState {
  // The page offers to clear the filter, so the copy names it.
  if (input.typeNoun) return { ...filteredState(input.typeNoun, input.term), icon: 'lucide-filter' }
  if (input.term)
    return {
      title: __('No results for “{0}”', [input.term]),
      description: __('Try a different search term.'),
      icon: 'lucide-search',
    }
  return { ...viewState(input), icon: DESTINATION_ICONS[input.destination] }
}

function filteredState(typeNoun: string, term: string): EmptyState {
  return term
    ? {
        title: `No ${typeNoun} match this search`,
        description: 'Try a different search term, or clear the filter.',
      }
    : { title: `No ${typeNoun} here`, description: 'Try another type, or clear the filter.' }
}

function addHint({ canCreate, canCreateDocuments }: EmptyStateInput): string {
  if (!canCreate) return ''
  return canCreateDocuments
    ? __('Use New to create a folder or a document.')
    : __('Use New to create a folder.')
}

/** What each view says when it has nothing to show. */
function viewState(input: EmptyStateInput): EmptyState {
  const hint = addHint(input)
  switch (input.destination) {
    case 'personal':
      return { title: 'No files yet', description: hint || 'Files you add will appear here.' }
    case 'organization': {
      const company = organizationName()
      if (company)
        return {
          title: __('No {0} files yet', [company]),
          description: hint || __('Files added for {0} will appear here.', [company]),
        }
      return {
        title: 'No organization files yet',
        description: hint || 'Files added for your organization will appear here.',
      }
    }
    case 'folder':
      if (input.inTrash)
        return {
          title: 'This folder is empty',
          description: 'It was empty when it was moved to Trash.',
        }
      return {
        title: 'This folder is empty',
        description: hint || 'Nothing has been added to this folder yet.',
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
