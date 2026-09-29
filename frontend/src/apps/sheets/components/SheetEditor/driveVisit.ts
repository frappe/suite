/**
 * Records that the caller opened a sheet, so it appears in Drive's Recents.
 *
 * Only the old `/sheets/<id>` page calls this. On `/d/` the Drive document
 * session records the visit when it opens.
 */
import { transport, type Operation } from '@/platform/transport'

const nodeVisit: Operation<{ node: string }, unknown> = {
  id: 'node_visit',
  owner: 'drive',
  method: 'POST',
  path: 'nodes/{node}/visit',
  pathParams: ['node'],
  nodeParams: ['node'],
}

export async function recordVisit(node: string): Promise<void> {
  await transport.request(nodeVisit, { node })
}
