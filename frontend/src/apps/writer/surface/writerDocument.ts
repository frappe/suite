import { reactive } from 'vue'

import type { DocumentSession } from '@/apps/drive'
import { TransportError } from '@/platform/transport'

import type { DocumentWrite } from './writes'

export type WriterSettings = Record<string, unknown>

export interface WriterDocumentRow {
  name: string
  collab?: number
  /** The collaborative body: a base64 Yjs update. */
  content?: string | null
  html?: string | null
  /** The inline comment threads: a base64 Yjs update. */
  ycomments?: string | null
  settings: WriterSettings
}

/** The row as the server stores it, with `settings` as JSON text. */
type StoredRow = Omit<WriterDocumentRow, 'settings'> & { settings?: string | WriterSettings | null }

export interface WriterDocument {
  /** The row, once it has loaded. */
  readonly doc: WriterDocumentRow | null
  /** `{ data, html? }`: stores the merged collaborative body. */
  readonly saveDoc: DocumentWrite
  /** `{ html }`: stores the body of a non-collaborative document. */
  readonly saveHtml: DocumentWrite
  /** `{ doc, data }`: stores the inline comment threads. */
  readonly saveComments: DocumentWrite
}

/**
 * Load one Writer document and send its saves.
 *
 * Every request goes through the document session, which adds the share-link
 * code the document was opened with (§6.2). So a guest who holds only a link
 * reads and saves what the link grants, and the server decides which.
 */
export function createWriterDocument(
  session: Pick<DocumentSession, 'contentDocname' | 'credentials'>,
): WriterDocument {
  const path = `/api/v2/document/${encodeURIComponent('Writer Document')}/${encodeURIComponent(session.contentDocname)}`

  async function send(url: string, body?: object): Promise<unknown> {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const init: RequestInit = { method: body ? 'POST' : 'GET', headers }
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['X-Frappe-CSRF-Token'] = window.csrf_token ?? ''
      init.body = JSON.stringify(body)
    }
    const response = await session.credentials.fetch(url, init)
    const payload: unknown = await response.json().catch(() => null)
    const record =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    if (!response.ok) throw refusal(response, record)
    return record.data
  }

  function write(url: string): DocumentWrite {
    const state = reactive({
      loading: false,
      error: null as unknown,
      async submit(params: object = {}) {
        state.loading = true
        state.error = null
        try {
          return await send(url, params)
        } catch (error) {
          state.error = error
          throw error
        } finally {
          state.loading = false
        }
      },
    })
    return state
  }

  const document = reactive({
    doc: null as WriterDocumentRow | null,
    saveDoc: write(`${path}/method/save_doc`),
    saveHtml: write(`${path}/method/save_html`),
    saveComments: write('/api/v2/method/suite.writer.api.docs.save_comments'),
  })

  void send(path).then(
    (row) => {
      document.doc = withSettings(row as StoredRow)
    },
    () => {
      // The session reads access itself and shows a refusal. Any other
      // failure leaves the surface's skeleton up.
    },
  )

  return document
}

function withSettings(row: StoredRow): WriterDocumentRow {
  const { settings } = row
  if (typeof settings === 'string')
    return { ...row, settings: JSON.parse(settings || '{}') as WriterSettings }
  return { ...row, settings: settings ?? {} }
}

/** The error a v2 response names in its `errors` envelope. */
function refusal(response: Response, body: Record<string, unknown>): TransportError {
  const first = Array.isArray(body.errors)
    ? (body.errors[0] as Record<string, unknown> | undefined)
    : undefined
  return new TransportError({
    type: typeof first?.type === 'string' ? first.type : 'RequestError',
    message: typeof first?.message === 'string' ? first.message : response.statusText,
    status: response.status,
  })
}
