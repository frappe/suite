/**
 * The people a comment's mention box offers and checks, from `/api/suite/people`.
 * A question about a document carries its share link.
 */
import type { MentionSuggestionItem } from 'frappe-ui/editor'

import { api, client } from '@/api'
import { documentCredentials } from '@/apps/drive/client/session'
import type { PeopleLookupOutputPersonUser } from '@/platform/transport/generated'

/** A person on this site, in the shape the mention menu reads. */
export interface MentionUser extends MentionSuggestionItem {
  name: string
  email: string
  full_name: string
  user_image: string | null
  value: string
  label: string
  /** Asked about a document: whether they can open it. */
  has_access?: boolean
  is_blocked?: boolean
}

function mentionUser(person: PeopleLookupOutputPersonUser): MentionUser {
  return {
    name: person.name,
    email: person.email,
    full_name: person.full_name ?? '',
    user_image: person.user_image,
    value: person.email,
    label: (person.full_name || person.email).trimEnd(),
    ...(person.has_access !== undefined && { has_access: person.has_access }),
    ...(person.is_blocked && { is_blocked: true }),
  }
}

/**
 * The first page of people who match `query`, from `GET /api/suite/people`,
 * which any Suite user may call. With no query it is the first page of
 * everyone. With `node`, people who can open that document come first, the
 * caller is left out, and each person says whether they can open it. The route
 * pages users and groups together, so groups are dropped. A question about a
 * document carries its share link, as the server reads a link commenter's role
 * from it.
 */
export async function searchUsers(query: string, node?: string | null): Promise<MentionUser[]> {
  const q = query.trim()
  const page = await client.query(
    api.suite.people.list,
    { ...(q && { q }), ...(node && { node }) },
    { context: node ? documentCredentials(node).context : undefined },
  )
  return page.rows.flatMap((row) => (row.kind === 'user' ? [mentionUser(row)] : []))
}

/**
 * The people among `users` who can't open `node`, as the mention menu marks
 * them. The lookup carries the share link, as a search on the document does. A
 * failed lookup counts nobody, so it never stops a comment.
 */
export async function peopleWithoutAccess(
  node: string,
  users: readonly string[],
): Promise<MentionUser[]> {
  const found = await client
    .query(
      api.suite.people.lookup,
      { node, users: [...users] },
      { context: documentCredentials(node).context },
    )
    .catch(() => [])
  return found.filter((person) => person.has_access === false).map(mentionUser)
}
