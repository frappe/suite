import { reactive } from 'vue'

import { api, client, useMutation, type OutputOf } from '@/api'
import type { DocumentSession } from '@/apps/drive'

export type WriterSettings = Record<string, unknown>
export type WriterDocumentRow = Omit<OutputOf<typeof api.writer.documents.get>, 'settings'> & {
  settings: WriterSettings
}

export function isLocked(settings: WriterSettings): boolean {
  return Boolean(settings.lock)
}

/** Writer keeps editable body state; Drive selects the open document's access scope. */
export function createWriterDocument(
  session: Pick<DocumentSession, 'contentDocname' | 'credentials'>,
) {
  const context = session.credentials.context
  const name = session.contentDocname
  const save = useMutation(api.writer.documents.save, { context, silent: true })
  const saveHTML = useMutation(api.writer.documents.saveHTML, { context, silent: true })
  const comments = useMutation(api.writer.comments.save, { context, silent: true })
  const document = reactive({
    doc: null as WriterDocumentRow | null,
    saveDoc: {
      get isPending() {
        return save.isPending
      },
      get error() {
        return save.error
      },
      run: (input: { data: string; html?: string }) => save.run({ name, ...input }),
    },
    saveHtml: {
      get isPending() {
        return saveHTML.isPending
      },
      get error() {
        return saveHTML.error
      },
      run: (input: { html: string }) => saveHTML.run({ name, ...input }),
    },
    saveComments: comments,
  })
  void client.query(api.writer.documents.get, { name }, { context }).then(
    (row) => {
      const settings: unknown =
        typeof row.settings === 'string' ? JSON.parse(row.settings || '{}') : row.settings
      document.doc = {
        ...row,
        settings:
          settings && typeof settings === 'object' && !Array.isArray(settings)
            ? (settings as WriterSettings)
            : {},
      }
    },
    () => {
      /* The Drive session displays access refusals. */
    },
  )
  return document
}

export type WriterDocument = ReturnType<typeof createWriterDocument>
