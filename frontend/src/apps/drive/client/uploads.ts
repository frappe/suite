/** Drive's transfer protocol: session, resume, bytes, finish, and progress stay together. */
import { api, client, type InputOf } from '@/api'
import type { TransferContext } from '@/platform/server-state'
import { transport, TransportError, type Transport } from '@/platform/transport'

import type { TransferInput } from './api'
import { driveLinks } from './links'
import type { DriveNode } from './types'

const MiB = 1024 * 1024
export const MAX_CHUNK_BYTES = 16 * MiB
const MIN_CHUNK_BYTES = MiB
const FIRST_CHUNK_BYTES = 2 * MiB
/** A chunk faster than this doubles the next one; slower than `SLOW_CHUNK_MS` halves it. */
const FAST_CHUNK_MS = 2000
const SLOW_CHUNK_MS = 8000
export type UploadSession =
  | { upload_id: string; mode: 'chunked' }
  | { upload_id: string; mode: 'direct'; url: string; fields: Record<string, string> }
export interface OpenUploadInput {
  parent_node: string
  filename: string
  size: number
  mime?: string
  replaces?: string
}

export function openUpload(input: OpenUploadInput, signal?: AbortSignal): Promise<UploadSession> {
  return client.mutation(api.drive.uploads.create, input, { signal, silent: true })
}

export async function probeUpload(
  uploadId: string,
  parent: string,
  signal?: AbortSignal,
): Promise<number> {
  const result = await chunk(uploadId, parent, 0, new Blob([]), signal)
  return result.received
}

export async function transfer(
  input: TransferInput,
  { signal, progress, client: requester, transport: wire }: TransferContext,
): Promise<DriveNode> {
  if (!(input.file instanceof Blob)) throw new TypeError('A transfer file must be a Blob')
  const filename =
    input.filename ?? (input.file instanceof File ? input.file.name : 'Untitled file')
  const session =
    input.start?.session ??
    (await requester.mutation(
      api.drive.uploads.create,
      {
        parent_node: input.parent_node,
        filename,
        size: input.file.size,
        mime: input.mime ?? input.file.type,
        replaces: input.replaces,
      },
      { signal, silent: true },
    ))
  signal.throwIfAborted()
  const offset = input.start?.offset ?? 0
  if (!Number.isInteger(offset) || offset < 0 || offset > input.file.size)
    throw new TypeError('Invalid resume offset')
  progress(input.file.size ? (offset / input.file.size) * 100 : 0)
  if (session.mode === 'direct') {
    await sendDirect(
      session,
      input.file,
      (sent) => progress(input.file.size ? (sent / input.file.size) * 100 : 100),
      signal,
    )
  } else {
    await sendChunks(input.file, session.upload_id, input.parent_node, offset, {
      signal,
      progress,
      wire,
    })
  }
  const finish: InputOf<typeof api.drive.uploads.finish> = {
    upload_id: session.upload_id,
    node: input.parent_node,
    ...(input.replaces
      ? { replaces: input.replaces }
      : { parent_node: input.parent_node, title: filename }),
  }
  if (input.checksum) finish.checksum = input.checksum
  const node = await requester.mutation(api.drive.uploads.finish, finish, { signal, silent: true })
  progress(100)
  return node
}

/**
 * The chunks from `offset` on, one after another. The server takes a chunk
 * again at any offset up to what it holds, so the size may change between
 * chunks. A bare 413 is a proxy's body limit, not a full Drive: the chunk
 * goes again at half the size.
 */
async function sendChunks(
  file: Blob,
  uploadId: string,
  parent: string,
  offset: number,
  {
    signal,
    progress,
    wire,
  }: { signal: AbortSignal; progress(value: number): void; wire: Transport },
) {
  const size = new ChunkSize()
  while (offset < file.size) {
    const started = Date.now()
    let reply: { received: number }
    try {
      reply = await chunk(
        uploadId,
        parent,
        offset,
        file.slice(offset, offset + size.bytes),
        signal,
        wire,
      )
    } catch (cause) {
      if (isProxyRefusal(cause) && size.shrink()) continue
      throw cause
    }
    signal.throwIfAborted()
    if (reply.received <= offset || reply.received > file.size)
      throw new TypeError('Invalid transfer progress')
    size.took(Date.now() - started)
    offset = reply.received
    progress((offset / file.size) * 100)
  }
}

/**
 * The next chunk's size. Chunks start small and follow the link's speed, so
 * progress moves on a slow link and a lost chunk costs seconds.
 */
class ChunkSize {
  bytes = FIRST_CHUNK_BYTES
  /** The largest size the way to the server accepts. */
  private ceiling = MAX_CHUNK_BYTES

  /** After a chunk that took `ms`. */
  took(ms: number) {
    if (ms < FAST_CHUNK_MS) this.bytes = Math.min(this.bytes * 2, this.ceiling)
    else if (ms > SLOW_CHUNK_MS) this.bytes = Math.max(this.bytes / 2, MIN_CHUNK_BYTES)
  }

  /** The chunk was too large for a proxy. `false` when it is already the smallest. */
  shrink(): boolean {
    if (this.bytes <= MIN_CHUNK_BYTES) return false
    this.bytes = this.ceiling = Math.max(this.bytes / 2, MIN_CHUNK_BYTES)
    return true
  }
}

/** A 413 without Drive's own type: a proxy refused the body. */
export function isProxyRefusal(cause: unknown): boolean {
  return cause instanceof TransportError && cause.status === 413 && cause.type !== 'DriveOverQuota'
}

// Raw chunk traffic is a byte protocol, so it does not join the ordinary write queue.
function chunk(
  upload_id: string,
  parent: string,
  offset: number,
  chunk: Blob,
  signal?: AbortSignal,
  wire: Transport = transport,
) {
  const operation = { ...api.drive.uploads.chunk, scope: () => driveLinks.scope([parent]) }
  return wire.request(operation, { upload_id, offset, chunk }, { signal })
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
      reject(
        new TransportError({
          type: 'DriveDirectUploadFailed',
          message: storageMessage(request.responseText),
          status: request.status,
        }),
      )
    }
    request.onerror = () =>
      reject(
        new TransportError({
          type: 'RequestError',
          message: 'The file could not reach storage.',
          status: 0,
        }),
      )
    request.onabort = () => reject(new DOMException('The upload was stopped', 'AbortError'))
    const abort = () => request.abort()
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    request.onloadend = () => signal?.removeEventListener('abort', abort)
    request.send(form)
  })
}

/** S3 answers an XML error. Its `<Message>` is the one readable part. */
function storageMessage(body: string): string {
  const message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1]
  return message ? `Storage refused the file: ${message}` : 'Storage refused the file.'
}
