import { infinite, mutation, query } from '@/platform/server-state'

import { api } from './generated'
import { driveOperation } from './operation'
import { listingTypesParam, type DriveListingType, type DriveNode, type DrivePage } from './types'

export type DriveView = 'shared' | 'recents' | 'favourites' | 'trash' | 'search' | 'templates'

export interface ViewInput {
  view: DriveView
  limit?: number
  cursor?: string
  root?: string
  content_doctype?: string
  term?: string
  /** Keeps the nodes of any of these types. */
  types?: readonly DriveListingType[]
  expand?: string
}

type ViewRequest = Omit<ViewInput, 'types'> & { type?: string }

const viewOperation = driveOperation<ViewRequest, DrivePage>(api.view_list, { entity: true })
const clearOperation = driveOperation<{ nodes?: string[] }, { cleared: number }>(api.view_clear_recents, {
  looseInput: true,
})

export function view({ types, ...input }: ViewInput) {
  return infinite(viewOperation, { limit: 60, ...input, type: listingTypesParam(types) }, {
    cursorParam: 'cursor',
    member: (row: DriveNode) => {
      if (input.view === 'trash') return row.state === 'Trashed' && row.root === input.root
      if (input.view === 'favourites') return row.state === 'Active' && row.favourite !== false
      return row.state === 'Active'
    },
  })
}

export function recents(input: Pick<ViewInput, 'limit' | 'expand'> = {}) {
  return query(viewOperation, { view: 'recents', limit: 12, ...input }, {
    member: (row: DriveNode) => row.state === 'Active',
  })
}

export const clearRecents = () => mutation(clearOperation, { invalidates: ['view_list'] })
