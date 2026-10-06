/** Named node workflows and browser content addresses. Ordinary calls use @/api. */
import { api, client } from '@/api'

import type {
  NodeCreateCreateDocumentInput,
  NodeCreateCreateFolderInput,
  NodeCreateCreateLinkInput,
} from './generated'
import type { DriveNode } from './types'

export type CreateNodeInput =
  NodeCreateCreateFolderInput | NodeCreateCreateLinkInput | NodeCreateCreateDocumentInput

export async function createNode(input: CreateNodeInput): Promise<DriveNode> {
  if (input.kind === 'folder') return client.mutation(api.drive.nodes.createFolder, input)
  if (input.kind === 'link') return client.mutation(api.drive.nodes.createLink, input)
  return client.mutation(api.drive.nodes.createDocument, input)
}

export function createDocument(input: {
  parent_node: string
  content_doctype: string
}): Promise<DriveNode> {
  const title =
    input.content_doctype === 'Sheet'
      ? 'Untitled spreadsheet'
      : input.content_doctype === 'Presentation'
        ? 'Untitled presentation'
        : 'Untitled document'
  return client.mutation(api.drive.nodes.createDocument, { ...input, title, kind: 'document' })
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
