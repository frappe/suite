import { reactive } from 'vue'

import { api, client, type OutputOf } from '@/api'
import type { DocumentSession } from '@/apps/drive'
import { TransportError } from '@/platform/transport'

import { openFailureFor } from './collabMessages'

export type WriterSettings = Record<string, unknown>
export type WriterDocumentRow = Omit<OutputOf<typeof api.writer.documents.get>, 'settings'> & {
  settings: WriterSettings
}

/** The open document as the editors read it. */
export function editorFileOf(
  session: Pick<DocumentSession, 'nodeId' | 'title'>,
  isEditable: boolean,
) {
  return {
    doc: {
      name: session.nodeId,
      file_name: session.title.value,
      write: isEditable,
      modified: new Date().toISOString(),
    },
  }
}

export type EditorFile = ReturnType<typeof editorFileOf>

export function isLocked(settings: WriterSettings): boolean {
  return Boolean(settings.lock)
}

function parseSettings(stored: unknown): unknown {
  if (typeof stored === 'string') {
    return JSON.parse(stored || '{}')
  }

  return stored
}

function settingsOf(stored: unknown): WriterSettings {
  const settings = parseSettings(stored)
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as WriterSettings
  }

  return {}
}

function statusOf(error: unknown) {
  if (error instanceof TransportError) {
    return error.status
  }

  return null
}

/** Writer keeps editable body state; Drive selects the open document's access scope. */
export function createWriterDocument(
  session: Pick<DocumentSession, 'contentDocname' | 'credentials'>,
) {
  const context = session.credentials.context
  const name = session.contentDocname
  const document = reactive({
    doc: null as WriterDocumentRow | null,
    readFailure: null as string | null,
    reload: () => load(),
    setLocked,
    read,
  })
  async function load() {
    const row = await client.query(api.writer.documents.get, { name }, { context })
    document.doc = { ...row, settings: settingsOf(row.settings) }
    document.readFailure = null
  }

  async function setLocked(lock: boolean) {
    const row = document.doc
    if (!row) return
    const settings = { ...row.settings, lock }
    await client.mutation(
      api.writer.documents.updateSettings,
      { name, data: JSON.stringify(settings) },
      { context },
    )
    row.settings = settings
  }

  async function read() {
    document.readFailure = null
    try {
      await load()
    } catch (error) {
      document.readFailure = openFailureFor(null, statusOf(error))
    }
  }

  void read()
  return document
}

export type WriterDocument = ReturnType<typeof createWriterDocument>
