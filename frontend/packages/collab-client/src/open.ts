import * as Y from 'yjs'

import { readReply, toOpenError } from './answers'
import { randomHex } from './bytes'
import { decodeFrame, type OpenHeader } from './frames'
import type { Opening, RoomInit } from './opening'
import { REMOTE } from './origins'
import { Room } from './room'
import type { DeviceCopy, StoredSession } from './store'
import type { DeviceDoc, Opened, OpenOptions } from './types'

// Server-issued clientIDs sit below this; a tab offline picks its own above it
const DEVICE_ID_FLOOR = 2 ** 30
// Tries at a clientID before the offline open gives up, each lost only to another tab picking the same one
const PICK_ATTEMPTS = 3

// What an offline tab needs to pick and save its own clientID
interface DevicePick {
  doc: Y.Doc
  device: DeviceDoc
  lineage: string
  sid: string
  openFailure: unknown
}

export async function openCollabRoom(options: OpenOptions): Promise<Opened> {
  const { endpoints, device } = options

  let openAnswer
  try {
    openAnswer = await endpoints.open()
  } catch (error) {
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

  if (openAnswer.status !== 200) {
    throw toOpenError(openAnswer, options)
  }

  const { header, checkpoint, rows } = decodeFrame<OpenHeader>(openAnswer.bytes)
  if (header.state !== 'live') {
    return { state: header.state }
  }

  const doc = new Y.Doc()
  const sid = randomHex(16)
  let canWrite = !!header.can_write
  if (canWrite) {
    const answer = await endpoints.session(sid)
    const { client_id } = readReply(answer)
    if (answer.status === 200 && typeof client_id === 'number') {
      doc.clientID = client_id
    } else if (answer.status === 403 || answer.status === 404) {
      canWrite = false
    } else {
      throw toOpenError(answer, options)
    }
  }

  const init: RoomInit = {
    doc,
    lineage: header.lineage!,
    epoch: header.q_epoch ?? 0,
    canWrite,
    sid,
    bound: true,
  }
  const opening: Opening = {
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
  const room = new Room(init, options)
  await room.start(opening)
  return { state: 'live', room }
}

// The device copy, bound only once the server accepts the claim
async function openOffline(
  copy: DeviceCopy,
  device: DeviceDoc,
  options: OpenOptions,
  openFailure: unknown,
) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, copy.bytes, REMOTE)
  const sid = randomHex(16)
  if (copy.canWrite) {
    const pick: DevicePick = {
      doc,
      device,
      lineage: copy.lineage,
      sid,
      openFailure,
    }
    doc.clientID = await pickClientId(pick)
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
  const opening: Opening = {
    base: copy.rev,
    checkpoint: null,
    rows: [],
    offline: true,
  }
  const room = new Room(init, options)
  await room.start(opening)
  return room
}

// A clientID no session of this document has used, saved as this tab's session
async function pickClientId({
  doc,
  device,
  lineage,
  sid,
  openFailure,
}: DevicePick): Promise<number> {
  const { store, doc: docName } = device

  // Another tab took the same clientID between reading the sessions and saving this one
  for (let attempt = 1; ; attempt++) {
    const usedClientIds = new Set(Y.decodeStateVector(Y.encodeStateVector(doc)).keys())
    for (const session of await store.sessions(docName)) {
      usedClientIds.add(session.cid)
    }

    let clientId = 0
    while (!clientId || usedClientIds.has(clientId)) {
      clientId = DEVICE_ID_FLOOR + Math.floor(Math.random() * DEVICE_ID_FLOOR)
    }

    const session: StoredSession = {
      doc: docName,
      sid,
      lineage,
      cid: clientId,
      bound: false,
    }
    try {
      await store.saveSession(session)
      return clientId
    } catch (error) {
      if ((error as Error)?.name !== 'ConstraintError' || attempt === PICK_ATTEMPTS) {
        throw openFailure
      }
    }
  }
}
