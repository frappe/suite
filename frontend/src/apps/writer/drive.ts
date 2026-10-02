/**
 * Writer's calls to the Drive and Suite routes.
 *
 * The old Writer pages (`/writer`, `/writer/w/:id`) read a Drive File in the
 * legacy row shape. Drive answers nodes now, so this module reads the node and
 * publishes the few legacy field names those pages still render. The `/d/`
 * surface does not use it: it gets the same capabilities from its
 * `DocumentSession`.
 *
 * Every call goes to `/api/suite/drive/` or `/api/suite/`, never to a legacy
 * Drive method.
 */
import { api as suiteApi } from '@/platform/transport/generated'
import { transport, type Operation } from '@/platform/transport'

const READ = 10
const COMMENT = 20
const UPLOAD = 30
const EDIT = 40
const MANAGE = 50

interface NodeRow {
  name: string
  title: string
  kind: string
  parent: string | null
  state: string
  size: number
  mime: string | null
  content_doctype: string | null
  content_docname: string | null
  owner: string
  creation: string | null
  modified: string | null
  content_modified: string | null
  access?: { role?: number }
  breadcrumbs?: Array<{ name: string; title: string }>
  favourite?: boolean
}

/** One Writer document in the field names the old Writer pages render. */
export interface WriterFile {
  name: string
  file_name: string
  folder: string | null
  file_size: number
  file_type: 'Document'
  mime_type: string | null
  is_folder: 0
  content_doctype: string | null
  content_docname: string | null
  creation: string | null
  modified: string | null
  owner: string
  read: boolean
  comment: boolean
  upload: boolean
  write: boolean
  share: boolean
  /** Ancestors the caller may read, then the document itself. */
  breadcrumbs: Array<{ name: string; file_name: string }>
  /** Whether the caller has starred the document. */
  is_favourite: boolean
}

/** A person on this site, in the shape the mention menu reads. */
export interface WriterUser {
  name: string
  email: string
  full_name: string
  user_image: string | null
  value: string
  label: string
}

function driveOperation<Input, Output>(
  id: string,
  method: Operation['method'],
  path: string,
): Operation<Input, Output> {
  const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)
  const nodeParams = pathParams.includes('node') ? ['node'] : []
  return { id, owner: 'drive', method, path, pathParams, nodeParams }
}

/** One node's refusal in a batch answer (§11.5). */
interface BatchResult {
  ok: string[]
  failed: Array<{ node: string; type: string; message: string }>
}

const nodeGet = driveOperation<{ node: string; expand: string }, NodeRow>('node_get', 'GET', 'nodes/{node}')
const nodeVisit = driveOperation<{ node: string }, unknown>('node_visit', 'POST', 'nodes/{node}/visit')
const nodeRename = driveOperation<{ node: string; title: string }, NodeRow>(
  'node_patch.rename',
  'PATCH',
  'nodes/{node}',
)
const nodeState = driveOperation<{ node: string; state: 'Active' | 'Trashed' }, NodeRow>(
  'node_patch.state',
  'PATCH',
  'nodes/{node}',
)
const nodeBatchTrash = driveOperation<{ nodes: string[]; patch: { state: 'Trashed' } }, BatchResult>(
  'node_batch',
  'POST',
  'nodes/batch',
)
const nodeBatchPurge = driveOperation<{ nodes: string[] }, BatchResult>('node_batch_purge', 'POST', 'nodes/batch/purge')
const favouriteOn = driveOperation<{ node: string }, unknown>('node_put_favourite', 'PUT', 'nodes/{node}/favourite')
const favouriteOff = driveOperation<{ node: string }, unknown>(
  'node_delete_favourite',
  'DELETE',
  'nodes/{node}/favourite',
)

export async function readWriterFile(node: string): Promise<WriterFile> {
  const row = await transport.request(nodeGet, { node, expand: 'access,breadcrumbs' })
  const role = row.access?.role ?? 0
  return {
    name: row.name,
    file_name: row.title,
    folder: row.parent,
    file_size: row.size,
    file_type: 'Document',
    mime_type: row.mime,
    is_folder: 0,
    content_doctype: row.content_doctype,
    content_docname: row.content_docname,
    creation: row.creation,
    modified: row.content_modified ?? row.modified,
    owner: row.owner,
    read: role >= READ,
    comment: role >= COMMENT,
    upload: role >= UPLOAD,
    write: role >= EDIT,
    share: role >= MANAGE,
    breadcrumbs: [
      ...(row.breadcrumbs ?? []).map((step) => ({ name: step.name, file_name: step.title })),
      { name: row.name, file_name: row.title },
    ],
    is_favourite: row.favourite ?? false,
  }
}

export async function recordVisit(node: string): Promise<void> {
  await transport.request(nodeVisit, { node })
}

export async function renameNode(node: string, title: string): Promise<string> {
  return (await transport.request(nodeRename, { node, title })).title
}

export async function setNodeState(node: string, state: 'Active' | 'Trashed'): Promise<void> {
  await transport.request(nodeState, { node, state })
}

/**
 * Delete nodes forever. Used to roll back the pictures a failed import uploaded.
 *
 * Drive purges only a trash root (§8.8), so the nodes go to the trash first.
 * Trashing needs EDIT and purging needs MANAGE: a node the caller may trash
 * but not purge stays in the trash and expires with it. Both batches report a
 * refused node in `failed` instead of throwing, so one refusal stops nothing.
 */
export async function purgeNodes(nodes: readonly string[]): Promise<void> {
  if (!nodes.length) return
  const trashed = await transport.request(nodeBatchTrash, { nodes: [...nodes], patch: { state: 'Trashed' } })
  if (trashed.ok.length) await transport.request(nodeBatchPurge, { nodes: trashed.ok })
}

export async function setFavourite(node: string, favourite: boolean): Promise<void> {
  await transport.request(favourite ? favouriteOn : favouriteOff, { node })
}

/**
 * The site's people. `GET /api/suite/users` answers only a System Manager, so
 * anyone else gets an empty list until `GET /api/suite/people` ships.
 */
export async function listUsers(): Promise<WriterUser[]> {
  const rows = await transport.request(suiteApi.users_get, {})
  return rows.map((row) => ({
    name: row.name,
    email: row.email,
    full_name: row.full_name,
    user_image: row.user_image,
    value: row.email,
    label: row.full_name.trimEnd(),
  }))
}
