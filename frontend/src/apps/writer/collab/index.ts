import {
  openCollabRoom,
  openDeviceStore,
  type CollabEndpoints,
  type DeviceStore,
  type Opened,
  type OpenOptions,
} from '@suite/collab-client'

import type { DocumentSession } from '@/apps/drive'
import { getRealtimeSocket } from '@/platform/realtime'
import { getCookieSessionUser } from '@/platform/session'
import { createTransport, type HttpMethod, type Operation } from '@/platform/transport'

import { writerAdapter } from './adapter'

export { BODY_FIELD } from './field'

const contentOperation = (id: string, method: HttpMethod, path: string): Operation => ({
  id,
  owner: 'content',
  method,
  path,
  pathParams: ['node'],
  nodeParams: ['node'],
})

const OPEN = contentOperation('document_get', 'GET', '{node}/log')
const PULL = contentOperation('updates_get', 'GET', '{node}/updates')
const PUSH = contentOperation('updates_post', 'POST', '{node}/updates')
const SESSION = contentOperation('sessions_post', 'POST', '{node}/sessions')
const SUSPECT = contentOperation('suspect_post', 'POST', '{node}/suspect')
const RENDER = contentOperation('projection_post', 'POST', '{node}/projection')
const RESTORE = contentOperation('restore_post', 'POST', '{node}/restore')
const CANCEL_RESTORE = contentOperation('restore_cancel_post', 'POST', '{node}/restore/cancel')
const STAGE: Operation = {
  ...contentOperation('stage_put', 'PUT', '{node}/stage/{stage_id}/{idx}'),
  pathParams: ['node', 'stage_id', 'idx'],
}

const jsonBody = (value: object) => new TextEncoder().encode(JSON.stringify(value))

// Every request names who the tab expects to be, so the server can tell a lapsed sign-in from lost access
export function writerEndpoints(session: DocumentSession, principal: string): CollabEndpoints {
  const transport = createTransport({
    fetch: (url, init) => session.credentials.fetch(String(url), init),
  })
  const node = session.nodeId
  const headers = { 'X-Collab-Principal': principal }
  return {
    open: () => transport.requestBytes(OPEN, { node }, { headers }),
    pull: (since, epoch) => {
      const input = {
        node,
        since,
        q_epoch: epoch,
      }
      return transport.requestBytes(PULL, input, { headers })
    },
    push: (body, options) => {
      const bytesOptions = {
        body,
        keepalive: options?.keepalive,
        headers,
      }
      return transport.requestBytes(PUSH, { node }, bytesOptions)
    },
    stage: (stageId, pieceIndex, body) => {
      const input = {
        node,
        stage_id: stageId,
        idx: pieceIndex,
      }
      return transport.requestBytes(STAGE, input, { body, headers })
    },
    session: (sessionId, claim) => {
      const sessionClaim = claim ? { sid: sessionId, claim } : { sid: sessionId }
      const body = jsonBody(sessionClaim)
      return transport.requestBytes(SESSION, { node }, { body, headers })
    },
    suspect: (rev) => {
      const body = jsonBody({ rev })
      return transport.requestBytes(SUSPECT, { node }, { body, headers })
    },
    render: (stageId) => {
      const body = jsonBody({ stage_id: stageId })
      return transport.requestBytes(RENDER, { node }, { body, headers })
    },
    beginRestore: (seenRev, version) => {
      const body = jsonBody({ seen_rev: seenRev, version })
      return transport.requestBytes(RESTORE, { node }, { body, headers })
    },
    cancelRestore: (token) => {
      const body = jsonBody({ token })
      return transport.requestBytes(CANCEL_RESTORE, { node }, { body, headers })
    },
  }
}

const signedIn = () => getCookieSessionUser() ?? 'Guest'

// One store per person on this site; another person's stays untouched on the device
const deviceStores = new Map<string, Promise<DeviceStore | null>>()

function deviceStore(principal: string) {
  const storeKey = principal === 'Guest' ? 'guest' : principal
  let store = deviceStores.get(storeKey)
  if (!store) {
    store = openDeviceStore(`suite-writer-collab:${location.host}:${storeKey}`)
    deviceStores.set(storeKey, store)
  }

  return store
}

// The signed-in person's store on this device, or null where the browser keeps none
export function writerDeviceStore() {
  return deviceStore(signedIn())
}

// `threadsChanged` is told when the document's comment threads may have changed
export async function openWriterRoom(
  session: DocumentSession,
  threadsChanged: () => void,
): Promise<Opened> {
  const principal = signedIn()
  const store = await deviceStore(principal)
  const device = store && {
    store,
    doc: session.nodeId,
    title: () => session.title.value,
  }
  const options: OpenOptions = {
    endpoints: writerEndpoints(session, principal),
    principal,
    adapter: writerAdapter,
    signedIn,
    device,
    socket: getRealtimeSocket(),
    threadsChanged,
  }
  return openCollabRoom(options)
}
