// Client for the link-preview endpoint (hover card metadata). Deduped and
// memoised per URL for the session — the server caches too, but this avoids
// even the round-trip when the same link is hovered twice.

import { call } from '../utils/api.js'

const _cache = new Map() // url → result | in-flight promise

export function fetchLinkPreview(url) {
  if (!/^https?:\/\//i.test(url || '')) return Promise.resolve({ error: true })
  if (_cache.has(url)) return Promise.resolve(_cache.get(url))
  const p = call('suite.sheets.link_preview.get_link_preview', { url })
    .then((res) => res || { error: true })
    .catch(() => ({ error: true }))
    .then((res) => {
      _cache.set(url, res)
      return res
    })
  _cache.set(url, p)
  return p
}
