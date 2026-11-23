// What Sheets tells the content layer's client (platform/collab) about its
// documents: its app name, the schema version stamped on every push, how
// to read a peer's position, and the readable copy.

import type { CollabAdapter } from '@/platform/collab'

import { docToHtml } from './html'
import { SCHEMA_VERSION } from './schema'
import { readSavedSelection } from './selection'

export const SHEETS_APP = 'sheets'

export const sheetsAdapter: CollabAdapter = {
  app: SHEETS_APP,
  schemaVersion: SCHEMA_VERSION,
  // A peer's selection, by sheet id and row/col ids (selection.ts)
  toPeerPosition: readSavedSelection,
  toHtml: docToHtml,
}
