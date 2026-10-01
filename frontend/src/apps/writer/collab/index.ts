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

export function writerEndpoints(session: DocumentSession): CollabEndpoints {
  const transport = createTransport({ linkStore: session.credentials })
  const node = session.nodeId
  return {
    open: () => transport.requestBytes(OPEN, { node }),
    pull: (since) => transport.requestBytes(PULL, { node, since }),
    push: (body, options) => transport.requestBytes(PUSH, { node }, { body, keepalive: options?.keepalive }),
    session: (sid) =>
      transport.requestBytes(SESSION, { node }, { body: new TextEncoder().encode(JSON.stringify({ sid })) }),
  }
}

export function openWriterRoom(session: DocumentSession): Promise<Opened> {
  return openCollabRoom({ endpoints: writerEndpoints(session), principal: getCookieSessionUser() ?? 'Guest' })
}
