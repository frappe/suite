import { upload, type UploadDescriptor } from '@/platform/server-state'
import { transport } from '@/platform/transport'

import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveNode } from './types'

/** The largest chunk the server takes (`MAX_CHUNK_BYTES`, Drive §8.4). */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024

/** One open upload session. Only `chunked` sessions take chunks. */
export interface UploadSession {
  upload_id: string
  mode: 'chunked' | 'direct'
}

export interface OpenUploadInput {
  parent: string
  filename: string
  size: number
  mime?: string
  /** A replace session: the Active file below `parent` that the bytes replace. */
  replaces?: string
}

/** What finish needs besides the session: a resumed upload adds its sha256. */
export interface UploadFinishExtra {
  checksum?: string
}

export type UploadStartInput = OpenUploadInput & UploadFinishExtra

const openOperation = driveOperation<OpenUploadInput, UploadSession>(api.upload_create)
/**
 * The same create call, typed for a transfer's input. A resumed transfer
 * carries a `checksum` for finish; it always has a start, so create is skipped.
 */
const startOperation = driveOperation<UploadStartInput, UploadSession>(api.upload_create)

/**
 * Opens one session. A taken `filename` refuses with `DriveConflict` and its
 * `free_title`; no room refuses with `DriveOverQuota` (413).
 */
export function openUpload(input: OpenUploadInput, signal?: AbortSignal): Promise<UploadSession> {
  return transport.request(openOperation, input, { signal })
}

/**
 * The transfer for one file below `parent`: chunks one after another from the
 * start offset, then finish. It carries the link codes for `parent`, because
 * a chunk or finish names no node itself.
 */
export function uploadTransfer(parent: string): UploadDescriptor<UploadStartInput, DriveNode, UploadSession> {
  const chunk = {
    ...driveOperation<{ upload_id: string; offset: number; chunk: Blob }, { received: number }>(api.upload_chunk, {
      looseInput: true,
      covers: [parent],
    }),
    body: 'chunk',
  }
  const finish = driveOperation<Record<string, unknown>, DriveNode>(api.upload_finish, {
    entity: true,
    looseInput: true,
    covers: [parent],
  })
  return upload(startOperation, chunk, finish, {
    chunkSize: MAX_CHUNK_BYTES,
    chunkInput: (session, offset) => ({ upload_id: session.upload_id, offset }),
    finishInput: (input, session) => ({
      upload_id: session.upload_id,
      ...(input.replaces ? { replaces: input.replaces } : { parent: input.parent, title: input.filename }),
      ...(input.checksum ? { checksum: input.checksum } : {}),
    }),
    invalidates: ['node_children', 'view_list', 'root_usage'],
  })
}
