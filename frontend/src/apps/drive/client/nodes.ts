/** Named node workflows and browser content addresses. Ordinary calls use @/api. */
import { api, client } from '@/api'

import type {
  NodeCreateCreateDocumentInput,
  NodeCreateCreateFolderInput,
  NodeCreateCreateLinkInput,
} from './generated'
import type { DriveBreadcrumb, DriveNode } from './types'

export type CreateNodeInput =
  NodeCreateCreateFolderInput | NodeCreateCreateLinkInput | NodeCreateCreateDocumentInput

export async function createNode(input: CreateNodeInput): Promise<DriveNode> {
  if (input.kind === 'folder') return client.mutation(api.drive.nodes.createFolder, input)
  if (input.kind === 'link') return client.mutation(api.drive.nodes.createLink, input)
  return client.mutation(api.drive.nodes.createDocument, input)
}

/** Creates a document; `from_node` imports an uploaded file's contents into it (§10.1). */
export async function createDocument(input: {
  parent_node: string
  content_doctype: string
  title?: string
  from_node?: string
}): Promise<DriveNode> {
  const title =
    input.title ??
    (input.content_doctype === 'Sheet'
      ? 'Untitled spreadsheet'
      : input.content_doctype === 'Presentation'
        ? 'Untitled presentation'
        : input.content_doctype === 'Drawing'
          ? 'Untitled drawing'
          : 'Untitled document')
  // A sibling with the same title, such as an older "Untitled document", makes this one "(2)"
  return client.mutation(api.drive.nodes.createDocument, {
    ...input,
    title,
    kind: 'document',
    deduplicate_title: true,
  })
}

const SPREADSHEET_FILE = /\.(xlsx|csv)$/i

/** Whether a file is an uploaded .xlsx or .csv that can open as a new spreadsheet. */
export function opensAsSpreadsheet(node: Pick<DriveNode, 'kind' | 'title'>): boolean {
  return node.kind === 'file' && SPREADSHEET_FILE.test(node.title)
}

/** A new spreadsheet beside the file, holding its workbook. The file stays as it is. */
export function openAsSpreadsheet(file: {
  name: string
  title: string
  parent_node: string
}): Promise<DriveNode> {
  return createDocument({
    parent_node: file.parent_node,
    content_doctype: 'Sheet',
    title: file.title.replace(SPREADSHEET_FILE, ''),
    from_node: file.name,
  })
}

export async function findChild(
  parent: string,
  title: string,
  signal?: AbortSignal,
): Promise<DriveNode | null> {
  let cursor: string | undefined
  do {
    const page = await client.query(
      api.drive.nodes.children,
      { node: parent, limit: 200, cursor, order_by: 'title', ascending: true, expand: 'access' },
      { signal },
    )
    const match = page.rows.find((row) => row.title === title && row.state === 'Active')
    if (match) return match
    cursor = page.next_cursor ?? undefined
  } while (cursor)
  return null
}

export async function recordVisit(node: string): Promise<void> {
  await client.mutation(api.drive.nodes.visit, { node }, { silent: true })
}
export function hasDefaultDocumentTitle(title: string): boolean {
  return title.startsWith('Untitled document')
}
export function nodeContentUrl(
  node: string,
  { download = false, revision = 0 }: { download?: boolean; revision?: number } = {},
): string {
  const query = new URLSearchParams()
  if (download) query.set('download', '1')
  if (revision) query.set('v', String(revision))
  return `/api/suite/drive/nodes/${encodeURIComponent(node)}/content${query.size ? `?${query}` : ''}`
}

/** Kinds of node that hold files in a listing. */
const FOLDER_KINDS = new Set(['folder', 'root'])

/**
 * The breadcrumbs end at the node's own folder, when the caller can read it.
 * A picture inside a Writer document or a Slides deck has no folder: the
 * document is its parent, and a document is never listed as a folder.
 */
export function folderOf(node: DriveNode): DriveBreadcrumb | null {
  const trail = node.breadcrumbs ?? []
  const parent = trail.at(-1)
  if (!parent || parent.name !== node.parent_node || !FOLDER_KINDS.has(parent.kind)) {
    return null
  }

  return trail.some((step) => step.kind === 'document') ? null : parent
}
