import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

import { rememberDriveLink } from '@/apps/drive'

/**
 * Reads the share link that `/l/<token>` put in the URL fragment (spec §10.1).
 *
 * The server answers `/l/<token>` with a 302 to `/drive/f/<node>#link=<token>`
 * or `/d/<node>#link=<token>`. A router guard calls this before the node route
 * mounts: it seeds the Drive link store for that node, then answers the same
 * location without the fragment, so the first node request already carries
 * the code and the address bar keeps no token.
 */

const LINK_FRAGMENT = /^#link=([^&]*)$/

type Remember = (token: string, node: string) => void

/** `null` when the location carries no link fragment. */
export function takeLinkFragment(
  to: Pick<RouteLocationNormalized, 'hash' | 'params' | 'path' | 'query'>,
  remember: Remember = rememberDriveLink,
): RouteLocationRaw | null {
  const token = to.hash.match(LINK_FRAGMENT)?.[1]
  if (token === undefined) return null
  const node = to.params.node
  // The link store ignores a malformed token. The fragment goes either way.
  if (typeof node === 'string' && node) remember(token, node)
  return { path: to.path, query: to.query, hash: '', replace: true }
}
