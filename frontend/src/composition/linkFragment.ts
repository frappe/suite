import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

import { rememberDriveLink } from '@/apps/drive'

/**
 * Reads the share link that `/l/<token>` put in the URL fragment (spec §10.1).
 *
 * The server answers `/l/<token>` with a 302 to `/drive/f/<node>#link=<token>`
 * or `/d/<node>#link=<token>`. A router guard calls this before the node route
 * mounts: it seeds the Drive link store for that node, then answers the same
 * location without the token, so the first node request already carries the
 * code and the address bar keeps no token.
 *
 * The fragment is read as `&`-separated parameters. Every `link` parameter
 * goes, in any position and with or without a value. Other parameters stay as
 * written. A fragment with no `link` parameter is left alone.
 */

type Remember = (token: string, node: string) => void

export interface SplitFragment {
  /** The first non-empty `link` value, or `null`. */
  token: string | null
  /** The fragment without any `link` parameter: `''` or `#...`. */
  rest: string
  /** Whether the fragment carried a `link` parameter at all. */
  hadLink: boolean
}

export function splitLinkFragment(hash: string): SplitFragment {
  const parts = hash.replace(/^#/, '').split('&')
  let token: string | null = null
  let hadLink = false
  const kept = parts.filter((part) => {
    const separator = part.indexOf('=')
    const key = separator === -1 ? part : part.slice(0, separator)
    if (safeDecode(key) !== 'link') return part !== ''
    hadLink = true
    const value = separator === -1 ? '' : safeDecode(part.slice(separator + 1))
    if (value && token === null) token = value
    return false
  })
  return { token, hadLink, rest: kept.length ? `#${kept.join('&')}` : '' }
}

/** `null` when the location carries no link parameter in its fragment. */
export function takeLinkFragment(
  to: Pick<RouteLocationNormalized, 'hash' | 'params' | 'path' | 'query'>,
  remember: Remember = rememberDriveLink,
): RouteLocationRaw | null {
  const { token, rest, hadLink } = splitLinkFragment(to.hash)
  if (!hadLink) return null
  const node = to.params.node
  // The link store ignores a malformed token. The parameter goes either way.
  if (token && typeof node === 'string' && node) remember(token, node)
  return { path: to.path, query: to.query, hash: rest, replace: true }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}
