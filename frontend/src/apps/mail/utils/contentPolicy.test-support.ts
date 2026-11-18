// What a document's Content-Security-Policy lets it load, read the way a browser reads it (CSP
// Level 3), for tests that check a built document rather than the policy's own wording. A fetch
// takes the first of its directives the policy names; a policy naming none of them leaves that
// fetch unrestricted. jsdom enforces none of this, so the tests ask here instead.

const DIRECTIVES = {
  img: ['img-src', 'default-src'],
  font: ['font-src', 'default-src'],
  style: ['style-src-elem', 'style-src', 'default-src'],
  media: ['media-src', 'default-src'],
  connect: ['connect-src', 'default-src'],
  frame: ['frame-src', 'child-src', 'default-src'],
  object: ['object-src', 'default-src'],
  // <link rel="prefetch"> and its family, which CSP3 governs by default-src alone.
  prefetch: ['default-src'],
  script: ['script-src-elem', 'script-src', 'default-src'],
} as const

export type Fetch = keyof typeof DIRECTIVES

/** The policy first in `doc`'s head, as directive name to sources; undefined when there is none. */
export const headPolicy = (doc: Document): Map<string, string[]> | undefined => {
  const first = doc.head.firstElementChild
  if (first?.getAttribute('http-equiv')?.toLowerCase() !== 'content-security-policy') return
  return new Map(
    (first.getAttribute('content') ?? '')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => name)
      .map(([name, ...sources]) => [name.toLowerCase(), sources]),
  )
}

const sourcesFor = (policy: Map<string, string[]>, fetch: Fetch) =>
  DIRECTIVES[fetch].map((name) => policy.get(name)).find((sources) => sources !== undefined)

const matches = (source: string, url: URL, self: string) => {
  const lower = source.toLowerCase()
  if (lower === "'self'") return url.origin === self
  if (lower === '*') return /^(https?|wss?):$/.test(url.protocol)
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return url.protocol === lower
  if (lower.startsWith("'")) return false
  const host = lower.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[:/].*$/, '')
  return host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host
}

/** Whether a document at origin `self` under `policy` may fetch `url` for `fetch`. */
export const allowsLoad = (
  policy: Map<string, string[]> | undefined,
  fetch: Fetch,
  url: string,
  self: string,
) => {
  const sources = policy && sourcesFor(policy, fetch)
  if (!sources) return true
  const target = new URL(url, self)
  return sources.some((source) => matches(source, target, self))
}

/**
 * Whether inline code of the kind `fetch` may run or apply: with `nonce`, a <script> or <style>
 * carrying it; without, any inline one (a style attribute, a plain <style>).
 */
export const allowsInline = (
  policy: Map<string, string[]> | undefined,
  fetch: 'script' | 'style',
  nonce?: string,
) => {
  const sources = policy && sourcesFor(policy, fetch)
  if (!sources) return true
  if (nonce && sources.includes(`'nonce-${nonce}'`)) return true
  // A nonce or hash in the list switches 'unsafe-inline' off.
  const keyed = sources.some((source) => /^'(nonce|sha(256|384|512))-/.test(source))
  return !keyed && sources.includes("'unsafe-inline'")
}
