import { infinite, mutation, query } from '@/platform/server-state'
import { transport } from '@/platform/transport'

import { api } from './generated'
import { driveOperation } from './operation'
import { listingTypesParam, type DriveBatchResult, type DriveListingType, type DriveNode, type DrivePage } from './types'

export interface ChildrenInput {
  node: string
  limit?: number
  cursor?: string
  order_by?: string
  ascending?: boolean
  /** Keeps the nodes of any of these types. */
  types?: readonly DriveListingType[]
  expand?: string
}

const nodeGetOperation = driveOperation<{ node: string; expand?: string }, DriveNode>(api.node_get, {
  entity: true,
})
type ChildrenRequest = Omit<ChildrenInput, 'types'> & { type?: string }

const childrenOperation = driveOperation<ChildrenRequest, DrivePage>(api.node_children, { entity: true })
const createOperation = driveOperation<Record<string, unknown>, DriveNode>(api.node_create, {
  entity: true,
  looseInput: true,
})
export interface CreateDriveDocumentInput {
  /** The folder or root that receives the document. */
  parent: string
  content_doctype: string
}
type DocumentCreationInput = CreateDriveDocumentInput & { title?: string; kind?: 'document' }
const documentCreateOperation = {
  ...driveOperation<DocumentCreationInput, DriveNode>(api.node_create, { entity: true, looseInput: true }),
  // `POST /nodes` needs a title and a kind. A new document takes its type's default title.
  validateInput(value: unknown): asserts value is DocumentCreationInput {
    if (!value || typeof value !== 'object') throw new TypeError('Document creation input is required')
    const input = value as DocumentCreationInput
    if (!input.parent) throw new TypeError('parent is required')
    if (!input.content_doctype) throw new TypeError('content_doctype is required')
    input.title ||= defaultDocumentTitle(input.content_doctype)
    input.kind = 'document'
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
const purgeOperation = driveOperation<{ nodes: string[] }, DriveBatchResult>(api.node_batch_purge)
const emptyOperation = <Input>(operation: any, entity = false) =>
  driveOperation<Input, Record<string, never>>(operation, { entity })

export function node(node: string, expand = 'access,breadcrumbs') {
  return query(nodeGetOperation, { node, expand }, { member: (row: DriveNode) => row.name === node })
}

export function children({ types, ...input }: ChildrenInput) {
  return infinite(childrenOperation, { limit: 60, ...input, type: listingTypesParam(types) }, {
    cursorParam: 'cursor',
    member: (row: DriveNode) => row.parent === input.node && row.state === 'Active',
  })
}

/**
 * The Active child of `parent` titled `title`, with its access, or `null`.
 * A collision refusal names only the free title, so Replace looks the file up.
 */
export async function findChild(parent: string, title: string, signal?: AbortSignal): Promise<DriveNode | null> {
  let cursor: string | undefined
  do {
    const page = await transport.request(
      childrenOperation,
      { node: parent, limit: 200, cursor, order_by: 'title', ascending: true, expand: 'access' },
      { signal },
    )
    const match = page.rows.find((row) => row.title === title && row.state === 'Active')
    if (match) return match
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return null
}

export const createNode = () => mutation(createOperation, {
  invalidates: ['node_children', 'view_list'],
})

/** Create one generic content node with its type's default title. */
export const createDocument = () => mutation<CreateDriveDocumentInput, DriveNode>(documentCreateOperation, {
  invalidates: ['node_children', 'view_list'],
})

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

/** Deletes Trashed nodes forever, each under MANAGE. Answers `{ok, failed}`. */
export const purgeNodes = () => mutation(purgeOperation, {
  touches: ({ nodes }) => nodes,
  invalidates: ['node_children', 'view_list', 'root_usage'],
})

export const visitNode = () => mutation(emptyOperation<{ node: string }>(api.node_visit))

/** Record that the caller opened a node, for Recent. Outside any query cache. */
export async function recordVisit(node: string): Promise<void> {
  await transport.request(emptyOperation<{ node: string }>(api.node_visit), { node })
}
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
  if (contentDoctype === 'Sheet') return 'Untitled spreadsheet'
  if (contentDoctype === 'Presentation') return 'Untitled presentation'
  return 'Untitled document'
}
