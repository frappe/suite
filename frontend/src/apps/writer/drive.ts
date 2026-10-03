/**
 * Writer's calls to the Drive and Suite routes that `DocumentSession` does not
 * cover: purging the nodes a failed import uploaded, and the people list the
 * mention menu reads.
 *
 * Every call goes to `/api/suite/drive/` or `/api/suite/`, never to a legacy
 * Drive method.
 */
import { transport, type Operation } from '@/platform/transport'
import { api as suiteApi } from '@/platform/transport/generated'

/** A person on this site, in the shape the mention menu reads. */
export interface WriterUser {
  name: string
  email: string
  full_name: string
  user_image: string | null
  value: string
  label: string
}

function driveOperation<Input, Output>(
  id: string,
  method: Operation['method'],
  path: string,
): Operation<Input, Output> {
  const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)
  const nodeParams = pathParams.includes('node') ? ['node'] : []
  return { id, owner: 'drive', method, path, pathParams, nodeParams }
}

/** One node's refusal in a batch answer (§11.5). */
interface BatchResult {
  ok: string[]
  failed: Array<{ node: string; type: string; message: string }>
}

const nodeBatchTrash = driveOperation<
  { nodes: string[]; patch: { state: 'Trashed' } },
  BatchResult
>('node_batch', 'POST', 'nodes/batch')
const nodeBatchPurge = driveOperation<{ nodes: string[] }, BatchResult>(
  'node_batch_purge',
  'POST',
  'nodes/batch/purge',
)
/**
 * Delete nodes forever. Used to roll back the pictures a failed import uploaded.
 *
 * Drive purges only a trash root (§8.8), so the nodes go to the trash first.
 * Trashing needs EDIT and purging needs MANAGE: a node the caller may trash
 * but not purge stays in the trash and expires with it. Both batches report a
 * refused node in `failed` instead of throwing, so one refusal stops nothing.
 */
export async function purgeNodes(nodes: readonly string[]): Promise<void> {
  if (!nodes.length) return
  const trashed = await transport.request(nodeBatchTrash, {
    nodes: [...nodes],
    patch: { state: 'Trashed' },
  })
  if (trashed.ok.length) await transport.request(nodeBatchPurge, { nodes: trashed.ok })
}

/**
 * The first page of people who match `query`, from `GET /api/suite/people`,
 * which any Suite user may call. With no query it is the first page of
 * everyone. The route pages users and groups together, so groups are dropped.
 */
export async function searchUsers(query: string): Promise<WriterUser[]> {
  const q = query.trim()
  const page = await transport.request(suiteApi.people_get, q ? { q } : {})
  return page.rows.flatMap((row) =>
    row.kind === 'user'
      ? [
          {
            name: row.name,
            email: row.email,
            full_name: row.full_name ?? '',
            user_image: row.user_image,
            value: row.email,
            label: (row.full_name || row.email).trimEnd(),
          },
        ]
      : [],
  )
}
