import * as Y from 'yjs'
import { openError, readReply } from './answers'
import { decodeFrame } from './frames'
import { randomHex } from './outbox'
import { REMOTE, Room } from './room'
import type { DeviceCopy, StoredSession } from './store'
import type { Opened, OpenOptions } from './types'

// Server-issued clientIDs sit below this; a tab offline picks its own above it
const DEVICE_IDS = 2 ** 30

export async function openCollabRoom(options: OpenOptions): Promise<Opened> {
  const { endpoints, device } = options
  let opened
  try {
    opened = await endpoints.open()
  } catch (error) {
    const copy = device ? await device.store.copy(device.doc).catch(() => null) : null
    if (!copy) throw error
    return { state: 'live', room: await openOffline(copy, options, error) }
  }
  if (opened.status !== 200) throw openError(opened, options)
  const { header, checkpoint, rows } = decodeFrame(opened.bytes)
  if (header.state !== 'live') return { state: header.state }

  const doc = new Y.Doc()
  let canWrite = !!header.can_write
  const sid = randomHex(16)
  if (canWrite) {
    const answer = await endpoints.session(sid)
    const { client_id } = readReply(answer)
    if (answer.status === 200 && typeof client_id === 'number') doc.clientID = client_id
    else if (answer.status === 403 || answer.status === 404) canWrite = false
    else throw openError(answer, options)
  }
  const room = new Room({ doc, lineage: header.lineage!, canWrite, sid, bound: true }, options)
  await room.start({ base: header.base ?? 0, checkpoint, rows })
  return { state: 'live', room }
}

// The device copy, with a clientID no session of this document has used, bound only once the server accepts the claim
async function openOffline(copy: DeviceCopy, options: OpenOptions, unreachable: unknown) {
  const { store, doc: key } = options.device!
  const doc = new Y.Doc()
  Y.applyUpdate(doc, copy.bytes, REMOTE)
  const sid = randomHex(16)
  // Another tab took the same clientID between reading the sessions and saving this one
  for (let attempt = 0; copy.canWrite; attempt++) {
    const used = new Set([...Y.decodeStateVector(Y.encodeStateVector(doc)).keys()])
    for (const session of await store.sessions(key)) used.add(session.cid)
    let cid = 0
    while (!cid || used.has(cid)) cid = DEVICE_IDS + Math.floor(Math.random() * DEVICE_IDS)
    const session: StoredSession = {
      doc: key,
      sid,
      lineage: copy.lineage,
      cid,
      bound: false,
    }
    try {
      await store.saveSession(session)
      doc.clientID = cid
      break
    } catch (error) {
      if ((error as Error)?.name !== 'ConstraintError' || attempt === 2) throw unreachable
    }
  }
  // A viewer has nothing to claim
  const room = new Room(
    {
      doc,
      lineage: copy.lineage,
      canWrite: copy.canWrite,
      sid,
      bound: !copy.canWrite,
    },
    options,
  )
  await room.start({ base: copy.rev, checkpoint: null, rows: [] })
  return room
}
