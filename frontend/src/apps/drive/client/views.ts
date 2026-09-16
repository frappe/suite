import { infinite, mutation, query } from '@/platform/server-state'

import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveNode, DrivePage } from './types'

export type DriveView = 'shared' | 'recents' | 'favourites' | 'trash' | 'search' | 'templates'

export interface ViewInput {
  view: DriveView
  limit?: number
  cursor?: string
  root?: string
  content_doctype?: string
  term?: string
  expand?: string
}

const viewOperation = driveOperation<ViewInput, DrivePage>(api.view_list, { entity: true })
const clearOperation = driveOperation<{ nodes?: string[] }, { cleared: number }>(api.view_clear_recents, {
  looseInput: true,
})

export function view(input: ViewInput) {
  return infinite(viewOperation, { limit: 60, ...input }, {
    cursorParam: 'cursor',
    member: (row: DriveNode) => {
      if (input.view === 'trash') return row.state === 'Trashed' && row.root === input.root
      if (input.view === 'favourites') return row.state === 'Active' && row.favourite !== false
      return row.state === 'Active'
    },
  })
}

export function recents(limit = 12) {
  return query(viewOperation, { view: 'recents', limit }, {
    member: (row: DriveNode) => row.state === 'Active',
  })
}

export const clearRecents = () => mutation(clearOperation, { invalidates: ['view_list'] })
