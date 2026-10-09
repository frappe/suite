import * as Y from 'yjs'

import { readReply, toOpenError } from './answers'
import { decodeFrame, type OpenHeader } from './frames'
import { randomHex } from './outbox'
import { REMOTE, Room, type Opening, type RoomInit } from './room'
import type { DeviceCopy, StoredSession } from './store'
import type { Opened, OpenOptions } from './types'

// Server-issued clientIDs sit below this; a tab offline picks its own above it
const DEVICE_ID_FLOOR = 2 ** 30

export async function openCollabRoom(options: OpenOptions): Promise<Opened> {
  const { endpoints, device } = options

  let openAnswer
  try {
    openAnswer = await endpoints.open()
  } catch (error) {
    if (!device) throw error

    const copy = await device.store.copy(device.doc).catch(() => null)
    if (!copy) throw error

    const room = await openOffline(copy, options, error)
    return { state: 'live', room }
  }

  if (openAnswer.status !== 200) throw toOpenError(openAnswer, options)

  const { header, checkpoint, rows } = decodeFrame<OpenHeader>(openAnswer.bytes)
  if (header.state !== 'live') return { state: header.state }

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
  }
  const room = new Room(init, options)
  await room.start(opening)
  return { state: 'live', room }
}

// The device copy, bound only once the server accepts the claim
async function openOffline(copy: DeviceCopy, options: OpenOptions, openFailure: unknown) {
  const doc = new Y.Doc()
  Y.applyUpdate(doc, copy.bytes, REMOTE)
  const sid = randomHex(16)
  if (copy.canWrite) {
    doc.clientID = await claimClientId(doc, copy, options, sid, openFailure)
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
async function claimClientId(
  doc: Y.Doc,
  copy: DeviceCopy,
  options: OpenOptions,
  sid: string,
  openFailure: unknown,
): Promise<number> {
  const { store, doc: docName } = options.device!

  // Another tab took the same clientID between reading the sessions and saving this one
  for (let attempt = 0; ; attempt++) {
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
      lineage: copy.lineage,
      cid: clientId,
      bound: false,
    }
    try {
      await store.saveSession(session)
      return clientId
    } catch (error) {
      if ((error as Error)?.name !== 'ConstraintError' || attempt === 2) throw openFailure
    }
  }
}
