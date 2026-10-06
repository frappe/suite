/** Drive's transfer protocol: session, resume, bytes, finish, and progress stay together. */
import { api, client } from '@/api'
import type { TransferContext } from '@/platform/server-state'
import { transport, TransportError, type Transport } from '@/platform/transport'

import type { TransferInput } from './api'
import { driveLinks } from './links'
import type { DriveNode } from './types'

export const MAX_CHUNK_BYTES = 16 * 1024 * 1024
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
  let offset = input.start?.offset ?? 0
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
    while (offset < input.file.size) {
      const bytes = input.file.slice(offset, offset + MAX_CHUNK_BYTES)
      const reply = await chunk(session.upload_id, input.parent_node, offset, bytes, signal, wire)
      signal.throwIfAborted()
      if (reply.received <= offset || reply.received > input.file.size)
        throw new TypeError('Invalid transfer progress')
      offset = reply.received
      progress((offset / input.file.size) * 100)
    }
  }
  const node = await requester.mutation(
    api.drive.uploads.finish,
    {
      upload_id: session.upload_id,
      node: input.parent_node,
      ...(input.replaces
        ? { replaces: input.replaces }
        : { parent_node: input.parent_node, title: filename }),
      ...(input.checksum ? { checksum: input.checksum } : {}),
    },
    { signal, silent: true },
  )
  progress(100)
  return node
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
