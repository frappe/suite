import {
  openCollabRoom,
  openDeviceStore,
  type CollabEndpoints,
  type DeviceStore,
  type Opened,
} from '@suite/collab-client'

import type { DocumentSession } from '@/apps/drive'
import { getRealtimeSocket } from '@/platform/realtime'
import { getCookieSessionUser } from '@/platform/session'
import { createTransport, type HttpMethod, type Operation } from '@/platform/transport'

export { FIELD } from './field'

// Raise with suite/writer/content/features.json whenever the editor learns a new node, mark or attribute
export const WRITER_SCHEMA = 1

const route = (id: string, method: HttpMethod, path: string): Operation => ({
  id,
  owner: 'content',
  method,
  path,
  pathParams: ['node'],
  nodeParams: ['node'],
})

const OPEN = route('document_get', 'GET', '{node}/log')
const PULL = route('updates_get', 'GET', '{node}/updates')
const PUSH = route('updates_post', 'POST', '{node}/updates')
const SESSION = route('sessions_post', 'POST', '{node}/sessions')
const SUSPECT = route('suspect_post', 'POST', '{node}/suspect')
const STAGE: Operation = {
  ...route('stage_put', 'PUT', '{node}/stage/{stage_id}/{idx}'),
  pathParams: ['node', 'stage_id', 'idx'],
}

// Every request names who the tab expects to be, so the server can tell a lapsed sign-in from lost access
export function writerEndpoints(session: DocumentSession, principal: string): CollabEndpoints {
  const transport = createTransport({
    fetch: (url, init) => session.credentials.fetch(String(url), init),
  })
  const node = session.nodeId
  const headers = { 'X-Collab-Principal': principal }
  return {
    open: () => transport.requestBytes(OPEN, { node }, { headers }),
    pull: (since, epoch) =>
      transport.requestBytes(PULL, { node, since, q_epoch: epoch }, { headers }),
    push: (body, options) =>
      transport.requestBytes(PUSH, { node }, { body, keepalive: options?.keepalive, headers }),
    stage: (stage, idx, body) =>
      transport.requestBytes(STAGE, { node, stage_id: stage, idx }, { body, headers }),
    session: (sid, claim) =>
      transport.requestBytes(
        SESSION,
        { node },
        {
          body: new TextEncoder().encode(JSON.stringify(claim ? { sid, claim } : { sid })),
          headers,
        },
      ),
    suspect: (rev) =>
      transport.requestBytes(
        SUSPECT,
        { node },
        { body: new TextEncoder().encode(JSON.stringify({ rev })), headers },
      ),
  }
}

// Waits for slow work, but never longer than a person should be held up
export const withinTenSeconds = (work: Promise<void>) =>
  Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, 10_000))])

const signedIn = () => getCookieSessionUser() ?? 'Guest'

// One store per person on this site; another person's stays untouched on the device
const stores = new Map<string, Promise<DeviceStore | null>>()

function deviceStore(principal: string) {
  const key = principal === 'Guest' ? 'guest' : principal
  if (!stores.has(key))
    stores.set(key, openDeviceStore(`suite-writer-collab:${location.host}:${key}`))
  return stores.get(key)!
}

export async function openWriterRoom(session: DocumentSession): Promise<Opened> {
  const principal = signedIn()
  const store = await deviceStore(principal)
  return openCollabRoom({
    endpoints: writerEndpoints(session, principal),
    principal,
    schema: WRITER_SCHEMA,
    signedIn,
    device: store && { store, doc: session.nodeId },
    socket: getRealtimeSocket(),
  })
}
