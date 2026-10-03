import { infinite, mutation, query } from '@/platform/server-state'
import { transport, type Operation } from '@/platform/transport'

import {
  api,
  type NodeDeleteFavouriteInput,
  type NodeDeleteFavouriteOutput,
  type NodePutFavouriteInput,
  type NodePutFavouriteOutput,
  type NodeVisitInput,
  type NodeVisitOutput,
} from './generated'
import { driveOperation } from './operation'
import {
  listingTypesParam,
  type DriveBatchResult,
  type DriveListingType,
  type DriveNode,
  type DrivePage,
} from './types'

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

const nodeGetOperation = driveOperation<{ node: string; expand?: string }, DriveNode>(
  api.node_get,
  {
    entity: true,
  },
)
type ChildrenRequest = Omit<ChildrenInput, 'types'> & { type?: string }

const childrenOperation = driveOperation<ChildrenRequest, DrivePage>(api.node_children, {
  entity: true,
})

/** `POST /nodes` creates one of four kinds; `kind` picks the body (§8.3). */
export type CreateNodeInput =
  | { kind: 'folder'; parent_node: string; title: string }
  | { kind: 'link'; parent_node: string; title: string; url: string }
  | {
      kind: 'document'
      parent_node: string
      title: string
      content_doctype: string
      from_node?: string
      is_template?: boolean
    }
  | {
      kind: 'file'
      parent_node: string
      title: string
      blob: string
      size: number
      mime: string
      content_modified?: string
    }
type InputCheck = (input: unknown) => void
const createInputChecks: Record<CreateNodeInput['kind'], InputCheck | undefined> = {
  folder: api.node_create.create_folder.validateInput,
  link: api.node_create.create_link.validateInput,
  document: api.node_create.create_document.validateInput,
  file: api.node_create.create_file.validateInput,
}
function isCreateKind(kind: unknown): kind is CreateNodeInput['kind'] {
  return typeof kind === 'string' && Object.hasOwn(createInputChecks, kind)
}
// One mutation for the dialog that creates whichever kind was asked for; the
// input is checked against the generated shape of that kind.
const createOperation: Operation<CreateNodeInput, DriveNode> = {
  ...driveOperation<CreateNodeInput, DriveNode>(api.node_create.create_folder, { entity: true }),
  id: 'node_create',
  validateInput(value: unknown): asserts value is CreateNodeInput {
    const kind = value && typeof value === 'object' && 'kind' in value ? value.kind : undefined
    if (!isCreateKind(kind)) throw new TypeError('kind must be folder, link, document or file')
    createInputChecks[kind]?.(value)
  },
}
export interface CreateDriveDocumentInput {
  /** The folder or root that receives the document. */
  parent_node: string
  content_doctype: string
}
type DocumentCreationInput = CreateDriveDocumentInput & { title?: string; kind?: 'document' }
const documentCreateOperation = {
  ...driveOperation<DocumentCreationInput, DriveNode>(api.node_create.create_document, {
    entity: true,
  }),
  // `POST /nodes` needs a title and a kind. A new document takes its type's default title.
  validateInput(value: unknown): asserts value is DocumentCreationInput {
    if (!value || typeof value !== 'object')
      throw new TypeError('Document creation input is required')
    const input = value as DocumentCreationInput
    if (!input.content_doctype) throw new TypeError('content_doctype is required')
    input.title ||= defaultDocumentTitle(input.content_doctype)
    input.kind = 'document'
    api.node_create.create_document.validateInput?.(input)
  },
}
const renameOperation = driveOperation<{ node: string; title: string }, DriveNode>(
  api.node_patch.rename,
  {
    entity: true,
  },
)
/** A move may name the folder it expects the node in; the server refuses it (409) once the node moved on. */
const moveOperation = driveOperation<
  { node: string; parent_node: string; expect_parent_node?: string },
  DriveNode
>(api.node_patch.move, { entity: true })
const trashOperation = driveOperation<{ node: string; state: 'Trashed' }, DriveNode>(
  api.node_patch.trash,
  {
    entity: true,
  },
)
const copyOperation = driveOperation<
  { node: string; parent_node: string; title?: string },
  DriveNode
>(api.node_copy, {
  entity: true,
})
const batchOperation = driveOperation<
  {
    nodes: string[]
    patch: { parent_node?: string; expect_parent_node?: string; state?: 'Active' | 'Trashed' }
  },
  DriveBatchResult
>(api.node_batch)
const purgeOperation = driveOperation<{ nodes: string[] }, DriveBatchResult>(api.node_batch_purge)
const visitOperation = driveOperation<NodeVisitInput, NodeVisitOutput>(api.node_visit)
const starOperation = driveOperation<NodePutFavouriteInput, NodePutFavouriteOutput>(
  api.node_put_favourite,
  {
    entity: true,
  },
)
const unstarOperation = driveOperation<NodeDeleteFavouriteInput, NodeDeleteFavouriteOutput>(
  api.node_delete_favourite,
  { entity: true },
)

export function node(node: string, expand = 'access,breadcrumbs') {
  return query(
    nodeGetOperation,
    { node, expand },
    { member: (row: DriveNode) => row.name === node },
  )
}

export function children({ types, ...input }: ChildrenInput) {
  return infinite(
    childrenOperation,
    { limit: 60, ...input, type: listingTypesParam(types) },
    {
      cursorParam: 'cursor',
      member: (row: DriveNode) => row.parent_node === input.node && row.state === 'Active',
    },
  )
}

/**
 * The Active child of `parent` titled `title`, with its access, or `null`.
 * A collision refusal names only the free title, so Replace looks the file up.
 */
export async function findChild(
  parent: string,
  title: string,
  signal?: AbortSignal,
): Promise<DriveNode | null> {
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

export const createNode = () =>
  mutation(createOperation, {
    invalidates: ['node_children', 'view_list'],
  })

/** Create one generic content node with its type's default title. */
export const createDocument = () =>
  mutation<CreateDriveDocumentInput, DriveNode>(documentCreateOperation, {
    invalidates: ['node_children', 'view_list'],
  })

export const renameNode = () =>
  mutation(renameOperation, {
    touches: ({ node }) => [node],
    optimistic: ({ title }) => ({ title }),
    invalidates: ['node_children', 'view_list'],
  })

export const moveNode = () =>
  mutation(moveOperation, {
    touches: ({ node }) => [node],
    optimistic: ({ parent_node }) => ({ parent_node }),
    invalidates: ['node_children', 'view_list'],
  })

export const trashNode = () =>
  mutation(trashOperation, {
    touches: ({ node }) => [node],
    optimistic: () => ({ state: 'Trashed' }),
    invalidates: ['node_children', 'view_list'],
  })

export const copyNode = () =>
  mutation(copyOperation, {
    invalidates: ['node_children', 'view_list'],
  })

export const batchNodes = () =>
  mutation(batchOperation, {
    touches: ({ nodes }) => nodes,
    invalidates: ['node_children', 'view_list'],
  })

/** Deletes Trashed nodes forever, each under MANAGE. Answers `{ok, failed}`. */
export const purgeNodes = () =>
  mutation(purgeOperation, {
    touches: ({ nodes }) => nodes,
    invalidates: ['node_children', 'view_list', 'root_usage'],
  })

export const visitNode = () => mutation(visitOperation)

/** Record that the caller opened a node, for Recent. Outside any query cache. */
export async function recordVisit(node: string): Promise<void> {
  await transport.request(visitOperation, { node })
}
export const starNode = () =>
  mutation(starOperation, {
    touches: ({ node }) => [node],
    optimistic: () => ({ favourite: true }),
    invalidates: ['view_list'],
  })
export const unstarNode = () =>
  mutation(unstarOperation, {
    touches: ({ node }) => [node],
    optimistic: () => ({ favourite: false }),
    invalidates: ['view_list'],
  })

const DEFAULT_DOCUMENT_TITLE = 'Untitled document'

function defaultDocumentTitle(contentDoctype: string): string {
  if (contentDoctype === 'Sheet') return 'Untitled spreadsheet'
  if (contentDoctype === 'Presentation') return 'Untitled presentation'
  return DEFAULT_DOCUMENT_TITLE
}

/** True while a Writer document still has the title Drive gave it, with or without a copy suffix. */
export function hasDefaultDocumentTitle(title: string): boolean {
  return title.startsWith(DEFAULT_DOCUMENT_TITLE)
}
