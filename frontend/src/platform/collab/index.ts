import {
  openDeviceStore,
  openRoom,
  watchRooms,
  type CollabAdapter,
  type CollabEndpoints,
  type CollabRoom,
  type DeviceStore,
  type Opened,
} from '@suite/collab-client'

import { getRealtimeSocket } from '@/platform/realtime'
import { getCookieSessionUser } from '@/platform/session'
import {
  createTransport,
  type BytesTransport,
  type HttpMethod,
  type Operation,
} from '@/platform/transport'

export {
  ADOPT,
  APPLIED_UPDATE,
  MERGED_UPDATE,
  CollabOpenError,
  isRecoverable,
  sizeCheck,
  type Blocked,
  type CollabAdapter,
  type CollabRoom,
  type DeviceStore,
  type Fault,
  type Limits,
  type LostAccess,
  type Opened,
  type Peer,
  type RecoveryRecord,
  type RestoreResult,
  type RoomPresence,
  type RoomStatus,
} from '@suite/collab-client'

// The open document a room is for, as the app's file session gives it
export interface CollabSession {
  nodeId: string
  credentials: { fetch: (url: string, init?: RequestInit) => Promise<Response> }
  title: { readonly value: string }
}

function contentOperation(id: string, method: HttpMethod, path: string): Operation {
  return {
    id,
    owner: 'content',
    method,
    path,
    pathParams: ['node'],
    nodeParams: ['node'],
  }
}

const OPEN = contentOperation('document_get', 'GET', '{node}/document')
const PULL = contentOperation('updates_get', 'GET', '{node}/updates')
const PUSH = contentOperation('updates_post', 'POST', '{node}/updates')
const SESSION = contentOperation('sessions_post', 'POST', '{node}/sessions')
const SUSPECT = contentOperation('suspect_post', 'POST', '{node}/suspect')
const RENDER = contentOperation('html_post', 'POST', '{node}/html')
const RESTORE = contentOperation('restore_post', 'POST', '{node}/restore')
const CANCEL_RESTORE = contentOperation('restore_cancel_post', 'POST', '{node}/restore/cancel')
const STAGE: Operation = {
  ...contentOperation('stage_put', 'PUT', '{node}/stage/{stage_id}/{piece_index}'),
  pathParams: ['node', 'stage_id', 'piece_index'],
}

function jsonBody(value: object) {
  return new TextEncoder().encode(JSON.stringify(value))
}

function syncEndpoints(
  transport: BytesTransport,
  node: string,
  headers: Record<string, string>,
): Pick<CollabEndpoints, 'open' | 'pull' | 'push'> {
  return {
    open: () => transport.requestBytes(OPEN, { node }, { headers }),
    pull: (sinceRev, epoch) => {
      const input = {
        node,
        since_rev: sinceRev,
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
  }
}

function stagingEndpoints(
  transport: BytesTransport,
  node: string,
  headers: Record<string, string>,
): Pick<CollabEndpoints, 'stage' | 'render'> {
  return {
    stage: (stageId, pieceIndex, body) => {
      const input = {
        node,
        stage_id: stageId,
        piece_index: pieceIndex,
      }
      return transport.requestBytes(STAGE, input, { body, headers })
    },
    render: (stageId) => {
      const body = jsonBody({ stage_id: stageId })
      return transport.requestBytes(RENDER, { node }, { body, headers })
    },
  }
}

function sessionEndpoints(
  transport: BytesTransport,
  node: string,
  headers: Record<string, string>,
): Pick<CollabEndpoints, 'session' | 'suspect'> {
  return {
    session: (sessionId, claim) => {
      const sessionClaim: Record<string, unknown> = { sid: sessionId }
      if (claim) {
        sessionClaim.claim = claim
      }

      const body = jsonBody(sessionClaim)
      return transport.requestBytes(SESSION, { node }, { body, headers })
    },
    suspect: (rev) => {
      const body = jsonBody({ rev })
      return transport.requestBytes(SUSPECT, { node }, { body, headers })
    },
  }
}

function restoreEndpoints(
  transport: BytesTransport,
  node: string,
  headers: Record<string, string>,
): Pick<CollabEndpoints, 'beginRestore' | 'cancelRestore'> {
  return {
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

// Every request names who the tab expects to be, so the server can tell a lapsed sign-in from lost access
function contentEndpoints(session: CollabSession, expectedUser: string): CollabEndpoints {
  const transport = createTransport({
    fetch: (url, init) => session.credentials.fetch(String(url), init),
  })
  const node = session.nodeId
  const headers = { 'X-Expected-User': expectedUser }
  return {
    ...syncEndpoints(transport, node, headers),
    ...stagingEndpoints(transport, node, headers),
    ...sessionEndpoints(transport, node, headers),
    ...restoreEndpoints(transport, node, headers),
  }
}

function signedIn() {
  return getCookieSessionUser() ?? 'Guest'
}

// One store per app and person on this site; another person's stays untouched on the device
const deviceStores = new Map<string, Promise<DeviceStore | null>>()

function deviceStore(app: string, user: string) {
  const storeKey = user === 'Guest' ? 'guest' : user
  const name = `suite-collab:${app}:${location.host}:${storeKey}`
  let store = deviceStores.get(name)
  if (!store) {
    store = openDeviceStore(name)
    deviceStores.set(name, store)
  }

  return store
}

// The signed-in person's store for `app` on this device, or null where the browser keeps none
export function openSignedInDeviceStore(app: string) {
  return deviceStore(app, signedIn())
}

async function roomDevice(session: CollabSession, app: string, user: string) {
  const store = await deviceStore(app, user)
  return (
    store && {
      store,
      doc: session.nodeId,
      title: () => session.title.value,
    }
  )
}

// Tells `onTold` once the server converts or refuses the document waiting in the rooms `keys` name
export function watchConversion(keys: string[], onTold: () => void) {
  return watchRooms(getRealtimeSocket(), keys, 'suite_collab_converted', onTold)
}

// `onThreadsChanged` is told when the document's comment threads may have changed;
// `watch` gets the room before it applies anything
export async function openCollabRoom({
  session,
  adapter,
  onThreadsChanged,
  watch,
}: {
  session: CollabSession
  adapter: CollabAdapter
  onThreadsChanged?: () => void
  watch?: (room: CollabRoom) => void
}): Promise<Opened> {
  const expectedUser = signedIn()
  const device = await roomDevice(session, adapter.app, expectedUser)
  return openRoom({
    endpoints: contentEndpoints(session, expectedUser),
    expectedUser,
    adapter,
    signedIn,
    device,
    socket: getRealtimeSocket(),
    threadsChanged: onThreadsChanged,
    watch,
  })
}
