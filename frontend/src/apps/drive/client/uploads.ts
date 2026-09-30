import { mutation, upload, type UploadDescriptor } from '@/platform/server-state'
import { TransportError, transport } from '@/platform/transport'

import { api } from './generated'
import { driveOperation } from './operation'
import type { DriveNode } from './types'

/** The largest chunk the server takes (`MAX_CHUNK_BYTES`, Drive §8.4). */
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024

/**
 * One open upload session. A `chunked` session takes chunks through Drive. A
 * `direct` session names a storage target, today an S3 presigned POST: the
 * browser posts `fields` and then the file to `url` in one form request.
 */
export type UploadSession =
  | { upload_id: string; mode: 'chunked' }
  | { upload_id: string; mode: 'direct'; url: string; fields: Record<string, string> }

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

/**
 * How many bytes the server holds for a chunked session. It sends an empty
 * chunk at offset 0, which the server accepts, writes nothing for, and
 * answers with `received`. A session that is gone refuses it.
 */
export async function probeUpload(uploadId: string, parent: string, signal?: AbortSignal): Promise<number> {
  const probe = {
    ...driveOperation<{ upload_id: string; offset: number; chunk: Blob }, { received: number }>(api.upload_chunk, {
      looseInput: true,
      covers: [parent],
    }),
    body: 'chunk',
  }
  const reply = await transport.request(probe, { upload_id: uploadId, offset: 0, chunk: new Blob([]) }, { signal })
  return reply.received
}

/** True when the server no longer knows the session: expired, finished or swept. */
export function isSessionGone(error: { type: string; message: string }): boolean {
  return error.type === 'DriveNotFound' || /not found or expired|has no data/i.test(error.message)
}

/**
 * Sends a file to a direct session's storage target in one form POST.
 * `fetch` cannot report upload progress, so this uses XHR. The target is
 * another origin: it gets no cookies and no Drive headers.
 */
export function sendDirect(
  session: Extract<UploadSession, { mode: 'direct' }>,
  file: Blob,
  onProgress: (sent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData()
  for (const [key, value] of Object.entries(session.fields)) form.append(key, value)
  // S3 reads every field before the file and ignores fields after it.
  form.append('file', file)
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', session.url)
    request.upload.onprogress = (event) => onProgress(Math.min(event.loaded, file.size))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve()
      reject(new TransportError({ type: 'DriveDirectUploadFailed', message: storageMessage(request.responseText), status: request.status }))
    }
    request.onerror = () => reject(new TransportError({ type: 'RequestError', message: 'The file could not reach storage.', status: 0 }))
    request.onabort = () => reject(new DOMException('The upload was stopped', 'AbortError'))
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    request.send(form)
  })
}

/** S3 answers an XML error. Its `<Message>` is the one readable part. */
function storageMessage(body: string): string {
  const message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1]
  return message ? `Storage refused the file: ${message}` : 'Storage refused the file.'
}

export interface FinishUploadInput {
  upload_id: string
  parent?: string
  title?: string
  replaces?: string
  checksum?: string
}

/** Finishes a session whose bytes are already stored, as a direct upload's are. */
export function finishUpload(parent: string) {
  return mutation(
    driveOperation<FinishUploadInput, DriveNode>(api.upload_finish, { entity: true, looseInput: true, covers: [parent] }),
    { invalidates: ['node_children', 'view_list', 'root_usage'] },
  )
}
