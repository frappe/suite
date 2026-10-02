export type FilesDestination = 'personal' | 'organization' | 'folder' | 'shared' | 'recent' | 'starred' | 'trash'

export interface EmptyStateInput {
  destination: FilesDestination
  /** The trimmed search term, or empty when not searching. */
  term: string
  /** The caller can add items here, through the New menu. */
  canCreate: boolean
  /** Recent is filtered to one document type, by its label. */
  recentType?: string
}

export interface EmptyState {
  title: string
  description: string
}

/** Days an item stays in Trash before the daily job deletes it (`suite.drive.jobs.purge_trashed_nodes`). */
const TRASH_RETENTION_DAYS = 30

/** What an empty listing says, per view. */
export function emptyState({ destination, term, canCreate, recentType }: EmptyStateInput): EmptyState {
  if (term) return { title: 'No files match this search', description: 'Try a different search term.' }
  const addHint = canCreate ? 'Use New to add a folder, a document, or files.' : ''
  switch (destination) {
    case 'personal':
      return { title: 'No files yet', description: addHint || 'Files you add will appear here.' }
    case 'organization':
      return {
        title: 'No organization files yet',
        description: addHint || 'Files added for your organization will appear here.',
      }
    case 'folder':
      return { title: 'This folder is empty', description: addHint || 'Nothing has been added to this folder yet.' }
    case 'shared':
      return { title: 'Nothing shared with you yet', description: 'Files and folders that people share with you will appear here.' }
    case 'recent':
      return recentType
        ? { title: `No recent ${recentType.toLowerCase()}s`, description: `${recentType}s you open will appear here.` }
        : { title: 'No recent files', description: 'Files you open will appear here.' }
    case 'starred':
      return { title: 'No starred files', description: 'Star a file or folder to find it here quickly.' }
    case 'trash':
      return {
        title: 'Trash is empty',
        description: `Items you move to Trash stay here for ${TRASH_RETENTION_DAYS} days, then are deleted forever.`,
      }
  }
}
