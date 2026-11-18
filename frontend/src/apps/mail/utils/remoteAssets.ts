// What a message would fetch from elsewhere when opened, found and withheld until the reader
// asks: remote <img>, and remote references in inline styles and <style> blocks (background
// images, fonts, imported stylesheets). Kept out of the utils barrel so it can be tested without
// pulling in its Vue-component and frappe-ui imports.

// An externally-hosted reference (http/https or protocol-relative //). cid: (inline attachments) and
// data: URIs are part of the message, so they're never remote.
const REMOTE_URL = /^\s*(?:https?:)?\/\//i
const REMOTE_CSS_URL = /url\(\s*['"]?(?:https?:)?\/\//i
// A stylesheet imported by a bare string (`@import "https://…"`) rather than a url(). The string
// runs to its closing quote, or to a newline or the end of the stylesheet if it has none.
const REMOTE_CSS_IMPORT =
  /(@import\s*)(["'])\s*(?:https?:)?\/\/(?:(?!\2)[^\\\n\r\f]|\\[\s\S])*(?:\2|(?=[\n\r\f])|$)/gi

// Blank remote url(...) and imported stylesheets in a CSS string. Regex here is unavoidable — there's
// no DOM API to rewrite a url() inside a style string without pulling in the full CSSOM.
const blankRemoteCssUrls = (css: string) =>
  css
    .replace(/url\(\s*(['"]?)(?:https?:)?\/\/[^'")]*\1\s*\)/gi, 'url()')
    .replace(REMOTE_CSS_IMPORT, '$1""')

const hasRemoteCss = (css: string) =>
  REMOTE_CSS_URL.test(css) || css.replace(REMOTE_CSS_IMPORT, '') !== css

// Inspect the HTML for externally-hosted assets via the DOM (one parse): counts remote <img>, and flags
// whether any remote asset is present at all — a remote <img>, or a remote reference in an inline style
// or <style> block. Used to decide the "images blocked" banner and its count.
export const analyzeRemoteAssets = (html?: string) => {
  if (!html) return { images: 0, hasRemote: false }

  const doc = new DOMParser().parseFromString(html, 'text/html')

  const images = Array.from(doc.querySelectorAll('img')).filter((img) =>
    REMOTE_URL.test(img.getAttribute('src') || ''),
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
    if (!REMOTE_URL.test(src)) return
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
