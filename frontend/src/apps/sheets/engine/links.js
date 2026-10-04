// URL auto-detection for cell input — the Google Sheets behavior where typing
// or pasting "https://frappe.io/" turns the cell into a live link.
//
// Detection is whole-cell only: the trimmed value must BE the URL, not merely
// contain one. Partial-text links need per-run rich text, which cells don't
// have — fmt.hyperlink is cell-level.

// Bare-domain TLDs we auto-link without a scheme ("frappe.io", "google.com").
// Kept to common TLDs so "file.txt" or "v1.2" never turn into links; anything
// else still links fine when typed with http(s):// or www.
const BARE_TLDS = new Set([
  'com',
  'org',
  'net',
  'io',
  'dev',
  'ai',
  'app',
  'co',
  'in',
  'uk',
  'us',
  'de',
  'fr',
  'es',
  'it',
  'nl',
  'au',
  'ca',
  'jp',
  'br',
  'edu',
  'gov',
  'me',
  'so',
  'sh',
  'xyz',
  'info',
  'biz',
  'cloud',
  'tech',
  'site',
])

const SCHEME_RE = /^https?:\/\/[^\s]+$/i
const WWW_RE = /^www\.[^\s]+\.[^\s]+$/i
const DOMAIN_RE = /^([a-z0-9-]+\.)+([a-z]{2,24})(\/[^\s]*|\?[^\s]*|#[^\s]*)?$/i

// Returns the normalized target URL when `value` is a whole-cell URL, else
// null. Formulas, multi-token text, and bare emails never match (Sheets
// auto-links emails only in Docs, not in cells).
export function detectHyperlink(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v || /\s/.test(v) || v.startsWith('=')) return null
  if (SCHEME_RE.test(v)) return v
  // Past the scheme check, an '@' means an email (or userinfo trickery like
  // "evil.com@127.0.0.1") — never auto-link those schemeless.
  if (v.includes('@')) return null
  if (WWW_RE.test(v)) return 'https://' + v
  const m = v.match(DOMAIN_RE)
  if (m && BARE_TLDS.has(m[2].toLowerCase())) return 'https://' + v
  return null
}

// True when the cell's text is just its own URL (an auto-linked cell, not a
// custom display text set via the hyperlink dialog). Editing such a cell to a
// non-URL should drop the stale link; custom display text keeps it.
export function isAutoLinkText(text, url) {
  if (!url) return false
  const detected = detectHyperlink(String(text ?? ''))
  return detected === url
}
