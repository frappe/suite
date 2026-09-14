import { infinite, mutation, query, upload } from '@/platform/server-state'

import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveBatchResult, DriveNode, DrivePage, DriveRoots } from './types'

export interface ChildrenInput {
  node: string
  limit?: number
  cursor?: string
  order_by?: string
  ascending?: boolean
  kind?: 'folder'
  group_by?: 'type' | 'owner' | 'modified'
  expand?: string
}

const nodeGetOperation = driveOperation<{ node: string; expand?: string }, DriveNode>(api.node_get, {
  entity: true,
})
const childrenOperation = driveOperation<ChildrenInput, DrivePage>(api.node_children, { entity: true })
const createOperation = driveOperation<Record<string, unknown>, DriveNode>(api.node_create, {
  entity: true,
  looseInput: true,
})
export interface CreateDriveDocumentInput {
  content_doctype: string
}
type DocumentCreationInput = CreateDriveDocumentInput & {
  upload?: DriveRoots
  parent?: string
  title?: string
  kind?: 'document'
}
const discoverForCreation = {
  ...driveOperation<CreateDriveDocumentInput, DriveRoots>(api.roots_discover, { looseInput: true }),
  // Hide the workflow input from the roots query string.
  pathParams: ['content_doctype'],
}
const finishDocumentCreation = {
  ...driveOperation<DocumentCreationInput, DriveNode>(api.node_create, { entity: true, looseInput: true }),
  validateInput(value: unknown): asserts value is DocumentCreationInput {
    if (!value || typeof value !== 'object') throw new TypeError('Document creation input is required')
    const input = value as DocumentCreationInput
    if (!input.content_doctype) throw new TypeError('content_doctype is required')
    const personal = input.upload?.personal
    if (!personal?.node) throw new TypeError('The Personal Root is unavailable')
    input.parent = personal.node
    input.title = defaultDocumentTitle(input.content_doctype)
    input.kind = 'document'
    delete input.upload
  },
}
const renameOperation = driveOperation<{ node: string; title: string }, DriveNode>(api.node_patch.rename, {
  entity: true,
})
const moveOperation = driveOperation<{ node: string; parent: string }, DriveNode>(api.node_patch.move, {
  entity: true,
})
const trashOperation = driveOperation<{ node: string; state: 'Trashed' }, DriveNode>(api.node_patch.trash, {
  entity: true,
})
const copyOperation = driveOperation<{ node: string; parent: string; title?: string }, DriveNode>(api.node_copy, {
  entity: true,
})
const batchOperation = driveOperation<
  { nodes: string[]; patch: { parent?: string; state?: 'Active' | 'Trashed' } },
  DriveBatchResult
>(api.node_batch)
const emptyOperation = <Input>(operation: any, entity = false) =>
  driveOperation<Input, Record<string, never>>(operation, { entity })

export function node(node: string, expand = 'access,breadcrumbs') {
  return query(nodeGetOperation, { node, expand }, { member: (row: DriveNode) => row.name === node })
}

export function children(input: ChildrenInput) {
  return infinite(childrenOperation, { limit: 60, ...input }, {
    cursorParam: 'cursor',
    member: (row: DriveNode) => row.parent === input.node && row.state === 'Active',
  })
}

export const createNode = () => mutation(createOperation, {
  invalidates: ['node_children', 'view_list'],
})

/** Resolve the caller's Personal Root, then create one generic content node. */
export const createDocument = () => upload<CreateDriveDocumentInput, DriveNode>(
  discoverForCreation,
  api.upload_chunk,
  finishDocumentCreation,
  { invalidates: ['node_children', 'view_list'] },
)

export const renameNode = () => mutation(renameOperation, {
  touches: ({ node }) => [node],
  optimistic: ({ title }) => ({ title }),
  invalidates: ['node_children', 'view_list'],
})

export const moveNode = () => mutation(moveOperation, {
  touches: ({ node }) => [node],
  optimistic: ({ parent }) => ({ parent }),
  invalidates: ['node_children', 'view_list'],
})

export const trashNode = () => mutation(trashOperation, {
  touches: ({ node }) => [node],
  optimistic: () => ({ state: 'Trashed' }),
  invalidates: ['node_children', 'view_list'],
})

export const copyNode = () => mutation(copyOperation, {
  invalidates: ['node_children', 'view_list'],
})

export const batchNodes = () => mutation(batchOperation, {
  touches: ({ nodes }) => nodes,
  invalidates: ['node_children', 'view_list'],
})

export const visitNode = () => mutation(emptyOperation<{ node: string }>(api.node_visit))
export const starNode = () => mutation(emptyOperation<{ node: string }>(api.node_put_favourite, true), {
  touches: ({ node }) => [node],
  optimistic: () => ({ favourite: true }),
  invalidates: ['view_list'],
})
export const unstarNode = () => mutation(emptyOperation<{ node: string }>(api.node_delete_favourite, true), {
  touches: ({ node }) => [node],
  optimistic: () => ({ favourite: false }),
  invalidates: ['view_list'],
})

function defaultDocumentTitle(contentDoctype: string): string {
  if (contentDoctype === 'Spreadsheet') return 'Untitled spreadsheet'
  if (contentDoctype === 'Presentation') return 'Untitled presentation'
  return 'Untitled document'
}
