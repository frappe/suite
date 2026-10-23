/**
 * Writer's calls to the Drive and Suite routes that `DocumentSession` does not
 * cover: purging the nodes a failed import uploaded, and the people list the
 * mention menu reads.
 *
 * Every call goes to `/api/suite/drive/` or `/api/suite/`, never to a legacy
 * Drive method.
 */
import { api, client } from '@/api'

/** A person on this site, in the shape the mention menu reads. */
export interface WriterUser {
  name: string
  email: string
  full_name: string
  user_image: string | null
  value: string
  label: string
}

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
  const trashed = await client.mutation(api.drive.nodes.batch, {
    nodes: [...nodes],
    patch: { state: 'Trashed' },
  })
  if (trashed.ok.length) await client.mutation(api.drive.nodes.purgeBatch, { nodes: trashed.ok })
}

/**
 * The first page of people who match `query`, from `GET /api/suite/people`,
 * which any Suite user may call. With no query it is the first page of
 * everyone. The route pages users and groups together, so groups are dropped.
 */
export async function searchUsers(query: string): Promise<WriterUser[]> {
  const q = query.trim()
  const page = await client.query(api.suite.people.list, q ? { q } : {})
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
