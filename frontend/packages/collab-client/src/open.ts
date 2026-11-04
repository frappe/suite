import * as yjs from 'yjs'

import { HTTP_FORBIDDEN, HTTP_NOT_FOUND, HTTP_OK, readReply, toOpenError } from './answers'
import { randomHex } from './bytes'
import { decodeFrame, type LiveOpenHeader, type OpenHeader, type Row } from './frames'
import type { Opening, RoomInit } from './opening'
import { REMOTE } from './origins'
import { Room } from './room'
import type { DeviceCopy, DeviceStore, StoredSession } from './store'
import type { DeviceDoc, Opened, OpenOptions } from './types'

// Server-issued clientIDs sit below this; a tab offline picks its own above it
const DEVICE_ID_FLOOR = 2 ** 30
// Tries at a clientID before the offline open gives up, each lost only to another tab picking the same one
const PICK_ATTEMPTS = 3
const SID_BYTES = 16

// What an offline tab needs to pick and save its own clientID
interface DevicePick {
  doc: yjs.Doc
  device: DeviceDoc
  lineage: string
  sid: string
  openFailure: unknown
}

async function openFromDevice(options: OpenOptions, error: unknown): Promise<Opened> {
  const { device } = options
  if (!device) {
    throw error
  }

  const copy = await device.store.copy(device.doc).catch(() => null)
  if (!copy) {
    throw error
  }

  const room = await openOffline(copy, device, options, error)
  return { state: 'live', room }
}

async function openSession(options: OpenOptions, doc: yjs.Doc, sid: string) {
  const answer = await options.endpoints.session(sid)
  const { client_id } = readReply(answer)
  if (answer.status === HTTP_OK && typeof client_id === 'number') {
    doc.clientID = client_id
    return true
  }

  if (answer.status === HTTP_FORBIDDEN || answer.status === HTTP_NOT_FOUND) {
    return false
  }

  throw toOpenError(answer, options)
}

function liveOpening(header: LiveOpenHeader, checkpoint: Uint8Array | null, rows: Row[]): Opening {
  return {
    base: header.base ?? 0,
    schema: header.schema,
    checkpoint,
    rows,
    limits: header.limits,
    rooms: header.rooms,
    paceMs: header.pace_ms,
    restoringMs: header.restoring_ms,
    restoreRev: header.restore_rev,
  }
}

async function openLive(
  options: OpenOptions,
  header: LiveOpenHeader,
  checkpoint: Uint8Array | null,
  rows: Row[],
) {
  const doc = new yjs.Doc()
  const sid = randomHex(SID_BYTES)
  let canWrite = !!header.can_write
  if (canWrite) {
    canWrite = await openSession(options, doc, sid)
  }

  const init: RoomInit = {
    doc,
    lineage: header.lineage,
    epoch: header.q_epoch ?? 0,
    canWrite,
    sid,
    bound: true,
  }
  const room = new Room(init, options)
  await room.start(liveOpening(header, checkpoint, rows))
  return room
}

export async function openRoom(options: OpenOptions): Promise<Opened> {
  let openAnswer
  try {
    openAnswer = await options.endpoints.open()
  } catch (error) {
    return openFromDevice(options, error)
  }

  if (openAnswer.status !== HTTP_OK) {
    throw toOpenError(openAnswer, options)
  }

  const { header, checkpoint, rows } = decodeFrame<OpenHeader>(openAnswer.bytes)
  if (header.state !== 'live') {
    return { state: header.state }
  }

  const room = await openLive(options, header, checkpoint, rows)
  return { state: 'live', room }
}

// The device copy, bound only once the server accepts the claim
async function openOffline(
  copy: DeviceCopy,
  device: DeviceDoc,
  options: OpenOptions,
  openFailure: unknown,
) {
  const doc = new yjs.Doc()
  yjs.applyUpdate(doc, copy.bytes, REMOTE)
  const sid = randomHex(SID_BYTES)
  if (copy.canWrite) {
    doc.clientID = await pickClientId({ doc, device, lineage: copy.lineage, sid, openFailure })
  }

  // A viewer has nothing to claim
  const init: RoomInit = {
    doc,
    lineage: copy.lineage,
    epoch: copy.epoch ?? 0,
    canWrite: copy.canWrite,
    sid,
    bound: !copy.canWrite,
  }
  const opening: Opening = { base: copy.rev, checkpoint: null, rows: [], offline: true }
  const room = new Room(init, options)
  await room.start(opening)
  return room
}

async function usedClientIds(doc: yjs.Doc, store: DeviceStore, docName: string) {
  const used = new Set(yjs.decodeStateVector(yjs.encodeStateVector(doc)).keys())
  for (const session of await store.sessions(docName)) {
    used.add(session.cid)
  }

  return used
}

function freeClientId(used: Set<number>) {
  let clientId = 0
  while (!clientId || used.has(clientId)) {
    clientId = DEVICE_ID_FLOOR + Math.floor(Math.random() * DEVICE_ID_FLOOR)
  }

  return clientId
}

async function trySaveSession(
  store: DeviceStore,
  session: StoredSession,
): Promise<'saved' | 'clash' | 'failed'> {
  try {
    await store.saveSession(session)
    return 'saved'
  } catch (error) {
    return (error as Error)?.name === 'ConstraintError' ? 'clash' : 'failed'
  }
}

// A clientID no session of this document has used, saved as this tab's session
async function pickClientId({
  doc,
  device,
  lineage,
  sid,
  openFailure,
}: DevicePick): Promise<number> {
  // Another tab took the same clientID between reading the sessions and saving this one
  for (let attempt = 1; ; attempt++) {
    const clientId = freeClientId(await usedClientIds(doc, device.store, device.doc))
    const session: StoredSession = {
      doc: device.doc,
      sid,
      lineage,
      cid: clientId,
      bound: false,
    }
    const saved = await trySaveSession(device.store, session)
    if (saved === 'saved') {
      return clientId
    }

    if (saved === 'failed' || attempt === PICK_ATTEMPTS) {
      throw openFailure
    }
  }
}
