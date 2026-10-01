import { openCollabRoom, type CollabEndpoints, type Opened } from '@suite/collab-client'
import type { DocumentSession } from '@/apps/drive'
import { getCookieSessionUser } from '@/platform/session'
import { createTransport, type HttpMethod, type Operation } from '@/platform/transport'

// The fragment every Writer document has always kept its body in
export const FIELD = 'default'

const route = (id: string, method: HttpMethod, path: string): Operation => ({
  id,
  owner: 'writer',
  method,
  path,
  pathParams: ['node'],
  nodeParams: ['node'],
})

const OPEN = route('collab_get', 'GET', 'documents/{node}/collab')
const PULL = route('collab_updates_get', 'GET', 'documents/{node}/collab/updates')
const PUSH = route('collab_updates_post', 'POST', 'documents/{node}/collab/updates')
const SESSION = route('collab_sessions_post', 'POST', 'documents/{node}/collab/sessions')

// Every request names who the tab expects to be, so the server can tell a lapsed sign-in from lost access
export function writerEndpoints(session: DocumentSession, principal: string): CollabEndpoints {
  const transport = createTransport({ linkStore: session.credentials })
  const node = session.nodeId
  const headers = { 'X-Collab-Principal': principal }
  return {
    open: () => transport.requestBytes(OPEN, { node }, { headers }),
    pull: (since) => transport.requestBytes(PULL, { node, since }, { headers }),
    push: (body, options) =>
      transport.requestBytes(PUSH, { node }, { body, keepalive: options?.keepalive, headers }),
    session: (sid) =>
      transport.requestBytes(SESSION, { node }, { body: new TextEncoder().encode(JSON.stringify({ sid })), headers }),
  }
}

const signedIn = () => getCookieSessionUser() ?? 'Guest'

export function openWriterRoom(session: DocumentSession): Promise<Opened> {
  const principal = signedIn()
  return openCollabRoom({ endpoints: writerEndpoints(session, principal), principal, signedIn })
}
