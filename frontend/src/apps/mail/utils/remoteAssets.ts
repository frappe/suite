// What a message would fetch from elsewhere when opened, found and withheld until the reader
// asks: remote <img>, and remote references in inline styles and <style> blocks (background
// images, fonts, imported stylesheets). Kept out of the utils barrel so it can be tested without
// pulling in its Vue-component and frappe-ui imports.

// An externally-hosted reference (http/https or protocol-relative //), or anything the URL parser
// resolves to another host, since it forgives spellings a pattern misses (`https:\\host`, a tab in
// the scheme). cid: (inline attachments) and data: URIs are part of the message, so they're never
// remote.
const REMOTE_URL = /^\s*(?:https?:)?\/\//i

const isRemote = (url: string) => {
  if (REMOTE_URL.test(url)) return true
  try {
    const { protocol, origin } = new URL(url, window.location.href)
    return (protocol === 'http:' || protocol === 'https:') && origin !== window.location.origin
  } catch {
    return false
  }
}

// CSS may spell any character as an escape: `u\72l(` is `url(`, `\68ttps:` is `https:`.
const CSS_ESCAPE = /\\(?:([\da-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/gi

const unescapeCss = (text: string) =>
  text.replace(CSS_ESCAPE, (_, hex?: string, newline?: string, char?: string) => {
    if (newline !== undefined) return ''
    if (hex === undefined) return char ?? ''
    const code = parseInt(hex, 16)
    const invalid = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
    return invalid ? '�' : String.fromCodePoint(code)
  })

// A letter of a CSS name, as written or escaped (`r`, `\72`, `\000052 `, `\r`).
const cssLetter = (letter: string) => {
  const codes = [letter.toLowerCase(), letter.toUpperCase()].map((c) =>
    c.charCodeAt(0).toString(16),
  )
  return String.raw`(?:${letter}|\\(?:0{0,4}(?:${codes.join('|')})(?:\r\n|[ \t\r\n\f]|(?![\da-f]))|${letter}))`
}

// A string runs to its closing quote or the end of the stylesheet; one broken by a newline is no
// string to the browser either, so it doesn't match.
const CSS_STRING = String.raw`"(?:[^"\\\n\r\f]|\\[\s\S])*(?:"|$)|'(?:[^'\\\n\r\f]|\\[\s\S])*(?:'|$)`
const CSS_UNQUOTED_URL = String.raw`(?:[^)\s"'(\\]|\\[\s\S])*`

// Read left to right as the browser tokenizes, so a quote inside a comment or an escaped one can't
// hide what follows it: comments and escapes pass through untouched, and every url(…) and string
// (`@import "…"`, `image-set("…")`) is judged by what it decodes to.
const CSS_REFERENCE = new RegExp(
  String.raw`/\*[\s\S]*?(?:\*/|$)` +
    String.raw`|${[...'url'].map(cssLetter).join('')}\(\s*(${CSS_STRING}|${CSS_UNQUOTED_URL})` +
    `|(${CSS_STRING})` +
    String.raw`|\\[\s\S]`,
  'gi',
)

const unquote = (text: string) => text.replace(/^(["'])([\s\S]*?)\1?$/, '$2')

// Blank remote references in a CSS string: a url(…) keeps its name and loses its address, a string
// is emptied. Regex here is unavoidable — there's no DOM API to rewrite a url() inside a style string
// without pulling in the full CSSOM — and it only ever cuts the text, never writes a decoded
// character back, so nothing it decodes can close the <style> it sits in.
const blankRemoteCssUrls = (css: string) =>
  css.replace(CSS_REFERENCE, (token: string, url?: string, string?: string) => {
    const reference = url ?? string
    if (reference === undefined || !isRemote(unescapeCss(unquote(reference)))) return token
    return url === undefined ? '""' : token.slice(0, token.length - url.length)
  })

const hasRemoteCss = (css: string) => blankRemoteCssUrls(css) !== css

// Inspect the HTML for externally-hosted assets via the DOM (one parse): counts remote <img>, and flags
// whether any remote asset is present at all — a remote <img>, or a remote reference in an inline style
// or <style> block. Used to decide the "images blocked" banner and its count.
export const analyzeRemoteAssets = (html?: string) => {
  if (!html) return { images: 0, hasRemote: false }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  const images = Array.from(doc.querySelectorAll('img')).filter((img) =>
    isRemote(img.getAttribute('src') || ''),
  ).length

  const hasRemoteStyle =
    Array.from(doc.querySelectorAll('[style]')).some((el) =>
      hasRemoteCss(el.getAttribute('style') || ''),
    ) || Array.from(doc.querySelectorAll('style')).some((el) => hasRemoteCss(el.textContent || ''))

  return { images, hasRemote: images > 0 || hasRemoteStyle }
}

// Neutralize remote assets so the browser never requests them. Parses the (already-sanitized) HTML into a
// DOM and edits it there — robust against markup/attribute quirks regex would trip on: each remote <img>
// has its src stashed on data-blocked-src (and is tagged for hiding), and remote references in inline
// styles and <style> blocks are blanked. Inline (cid:) and data: assets are left to load as normal.
export const blockRemoteAssets = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || ''
    if (!isRemote(src)) return
    img.setAttribute('data-blocked-src', src)
    img.removeAttribute('src')
    img.setAttribute('data-blocked-image', '')
  })

  doc.querySelectorAll('[style]').forEach((el) => {
    const style = el.getAttribute('style') || ''
    const cleaned = blankRemoteCssUrls(style)
    if (cleaned !== style) el.setAttribute('style', cleaned)
  })

  doc.querySelectorAll('style').forEach((styleEl) => {
    const css = styleEl.textContent || ''
    const cleaned = blankRemoteCssUrls(css)
    if (cleaned !== css) styleEl.textContent = cleaned
  })

  return doc.documentElement.outerHTML
}
