// A spreadsheet's live room: the content layer's room (platform/collab) with
// this tab's workbook glued to it. Owns the room for as long as the editor
// shows it; the editor talks only to the glue, never the room.
//
//   server ⇄ room.doc ──receive()──▶ glue ──▶ IronCalc + side stores
//                 ▲                   │
//                 └──── forwarded ── doc (the glue's own copy)
//
// Two docs, because the glue must hold a server update while a local action
// is still open (its commands name rows by position until commit() turns them
// into ids; see glue.ts), and the room applies server rows to room.doc the
// moment they arrive. So the room keeps room.doc, the glue keeps `doc`, and
// updates cross over: the server's through glue.receive(), which waits for the
// open action; the glue's own (commits, undo) into room.doc, which sends them.
// `doc` writes with room.doc's clientID, so the server sees one tab, and undo
// can tell this tab's edits from everyone else's. Both docs are pinned to it:
// Yjs gives a doc a new clientID when an update from elsewhere carries writes
// of its own client (it takes that for two tabs sharing an id), which here
// happens on purpose, and the server refuses a push written by any other client.

import * as Y from 'yjs'

import { openCollabRoom, type CollabRoom, type CollabSession, type Opened } from '@/platform/collab'

import type { WorkbookClient } from '../core/client'
import { sheetsAdapter } from './adapter'
import { createGlue, type Glue } from './glue'
import type { GlueStores } from './stores'

export interface SheetRoom {
  readonly room: CollabRoom
  /** The glue's doc: what IronCalc and the stores show. */
  readonly doc: Y.Doc
  readonly glue: Glue
  /** Stop the glue and close the room (it sends what it can first). */
  close(): Promise<void>
}

/** `disabled`: Sheets' collaboration is off on this site, so the old save path runs. */
export type OpenedSheet =
  { state: 'live'; sheet: SheetRoom } | { state: 'disabled' } | { state: 'unconverted' }

export interface OpenSheetOptions {
  session: CollabSession
  /** A fresh workbook: the doc is built into it. */
  client: WorkbookClient
  stores: GlueStores
  /** Tests pass a fake. */
  open?: typeof openCollabRoom
}

// Origin of the glue's updates as room.doc receives them, so they don't come back.
const FORWARDED = Symbol('sheets-forwarded')

// Keep `doc` on `id`: Yjs's reassignment after a clash becomes a no-op.
function pinClientID(doc: Y.Doc, id: number): void {
  Object.defineProperty(doc, 'clientID', { get: () => id, set: () => {}, configurable: true })
}

export async function openSheetRoom({
  session,
  client,
  stores,
  open = openCollabRoom,
}: OpenSheetOptions): Promise<OpenedSheet> {
  let opened: Opened
  try {
    opened = await open({ session, adapter: sheetsAdapter })
  } catch (error) {
    // 404: no Sheets editor is registered on the server (its registration
    // isn't installed), or no route for it. The old path opens the sheet, and
    // says so itself if the sheet is missing.
    if ((error as { status?: unknown } | null)?.status === 404) return { state: 'disabled' }
    throw error
  }
  if (opened.state !== 'live') {
    return { state: opened.state === 'unconverted' ? 'unconverted' : 'disabled' }
  }
  const { room } = opened
  try {
    return { state: 'live', sheet: await glueRoom(room, client, stores) }
  } catch (error) {
    await room.close()
    throw error
  }
}

/** Whether the sheet opens live now (its conversion is done). The room opened to ask is closed again. */
export async function isLiveNow(
  session: CollabSession,
  open: typeof openCollabRoom = openCollabRoom,
): Promise<boolean> {
  const opened = await open({ session, adapter: sheetsAdapter })
  if (opened.state !== 'live') return false
  await opened.room.close()
  return true
}

async function glueRoom(
  room: CollabRoom,
  client: WorkbookClient,
  stores: GlueStores,
): Promise<SheetRoom> {
  const doc = new Y.Doc()
  const clientID = room.doc.clientID
  pinClientID(room.doc, clientID)
  pinClientID(doc, clientID)
  const glue = createGlue({ doc, client, stores })
  // The room's state so far; the glue builds IronCalc from it in load(), so it
  // reaches the doc as a remote update the glue doesn't apply yet.
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(room.doc), glue.remoteOrigin)

  const fromRoom = (update: Uint8Array, origin: unknown) => {
    if (origin !== FORWARDED) glue.receive(update)
  }
  const toRoom = (update: Uint8Array, origin: unknown) => {
    if (origin !== glue.remoteOrigin) Y.applyUpdate(room.doc, update, FORWARDED)
  }
  room.doc.on('update', fromRoom)
  doc.on('update', toRoom)
  const unhook = () => {
    room.doc.off('update', fromRoom)
    doc.off('update', toRoom)
    glue.stop()
  }

  try {
    // An empty doc (a sheet nobody has edited yet) is filled from the
    // workbook: one empty Sheet1.
    await glue.load()
  } catch (error) {
    unhook()
    doc.destroy()
    throw error
  }

  let closing: Promise<void> | null = null
  return {
    room,
    doc,
    glue,
    close() {
      closing ??= (async () => {
        // Commits still open reach room.doc before it sends its last.
        await glue.settled().catch(() => {})
        unhook()
        await room.close()
        doc.destroy()
      })()
      return closing
    },
  }
}
