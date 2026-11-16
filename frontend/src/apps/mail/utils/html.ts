// HTML helpers, kept out of the utils barrel so they can be used (and tested) without
// pulling in its Vue-component and frappe-ui imports.

import DOMPurify, { type UponSanitizeElementHook } from 'dompurify'

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  )

// Only the entities a server escapes a body with. Anything else is left as written,
// so `AT&T;` and a stray `&#5;` in real prose survive the round trip untouched.
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
])

const ENTITY = /&(?:#(\d+)|#[xX]([\da-fA-F]+)|([a-zA-Z]+));/g

// A body whose addresses the server already entity-escaped carries no real tags, so it
// takes the plain-text path — where escaping it a second time turns `&lt;` into
// `&amp;lt;` and the reader is shown the entity instead of the address it stands for.
// Normalising here (decode once; the consumer escapes after) makes the text mean what it
// says, whichever way the body arrived.
// Deliberately one pass: a genuinely double-escaped `&amp;lt;` decodes to `&lt;` and
// stops there. A second pass would decode that into a real `<` — turning text the sender
// wrote about markup back into markup, which is the bug in the other direction.
export const decodeHtmlEntities = (s: string) =>
  s.replace(ENTITY, (entity, decimal, hex, name) => {
    if (name) return NAMED_ENTITIES.get(name.toLowerCase()) ?? entity
    const code = Number.parseInt(decimal ?? hex, decimal ? 10 : 16)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })

// `<user@host>` in a body is an address, not markup — but the HTML parser reads it as
// an unknown tag and the sanitizer drops it, silently deleting the addresses a bounce
// notice is entirely about (its own `<a...>`-shaped text also fools hasHtmlContent
// below, so such a body can reach the reader as "HTML" either way). Escaping them has
// to happen before sanitizing, the last point where they still exist; the <b> marks
// the recipient the notice is reporting on.
// Deliberately loose about what an address may look like — `user@localhost` carries no
// dot, an address literal carries brackets (`user@[10.0.0.1]`), an internationalized
// mailbox carries neither in ASCII — because spelling out the grammar only decides
// which recipients still get deleted. The test applied is the parser's own: something
// with an `@` and no whitespace, which no real tag name can be.
const BRACKETED_ADDRESS = /<([^<>\s]+@[^<>\s]+)>/g

export const escapeBracketedAddresses = (html: string) =>
  html.replace(BRACKETED_ADDRESS, '<b>&lt;$1&gt;</b>')

// Mail still hides its stylesheets from clients that would print them as text, inside an
// HTML comment (`<style><!-- … --></style>`) or an XHTML CDATA section
// (`/*<![CDATA[*/ … /*]]>*/`). CSS reads straight past both, but the sanitizer drops any
// element whose text looks like markup, and with it about a third of real-world mail's
// stylesheets: the @media rules that stack a newsletter's columns on a phone, so the mail
// stayed 650px wide in a 360px pane. The wrappers mean nothing to CSS, so they go just
// before the sanitizer judges the stylesheet; any other markup-like text still costs it, as
// before. A hook rather than a pattern over the raw HTML: the parser has already found where
// each stylesheet ends, where a pattern scanned to the end of the mail once per unclosed
// <style>, and a body of them froze the tab.
const STYLE_WRAPPER = /<!--|-->|<!\[CDATA\[|\]\]>/g

const unwrapStyleSheet: UponSanitizeElementHook = (node, { tagName }) => {
  if (tagName !== 'style') return
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE && child.nodeValue)
      child.nodeValue = child.nodeValue.replace(STYLE_WRAPPER, '')
  })
}

// What a received message may keep: its layout, text formatting, images and stylesheets.
const MAIL_CONFIG = {
  ALLOWED_TAGS: [
    'html',
    'head',
    'body',
    'title',
    'meta',
    'style',
    'table',
    'tbody',
    'thead',
    'tfoot',
    'tr',
    'td',
    'th',
    'div',
    'span',
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    // Highlighted text. Without it KEEP_CONTENT hands the words back unstyled, so a
    // highlight applied in our own composer came back to the reader as plain text —
    // while the text colour beside it, which rides a <span>, survived.
    'mark',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'img',
    'blockquote',
    'ul',
    'ol',
    'li',
    'pre',
    'code',
  ],
  ALLOWED_ATTR: [
    'style',
    'class',
    'id',
    'width',
    'height',
    'align',
    'valign',
    'cellpadding',
    'cellspacing',
    // Without colspan/rowspan a table email's grid falls apart: rows stop
    // agreeing on column count, cells get crushed to slivers, and text can
    // land outside its authored background (seen as invisible/vertical text).
    'colspan',
    'rowspan',
    'border',
    'bgcolor',
    'color',
    'href',
    'src',
    'alt',
    'title',
    'target',
    'data-type',
    'data-id',
    'data-label',
    'data-list',
    'data-email-footer',
    // Suite's own templates opt out of the dark-mode remap with this (see
    // declaresFixedPalette); stripping it would silently re-enable remapping.
    'data-fixed-palette',
    // Apple Mail and Thunderbird mark a quoted trail with <blockquote type="cite">, the one thing
    // that tells it apart from a quote the writer made (see findQuoteRoots); without it the trail
    // was never folded away.
    'type',
    'xmlns',
    'content',
    'name',
    'http-equiv',
    'charset',
  ],
  KEEP_CONTENT: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ['meta', 'style', 'pre', 'code'],
  ADD_ATTR: ['cellpadding', 'cellspacing', 'border', 'bgcolor', 'xmlns', 'charset'],
  REMOVE_EMPTY: false,
}

// Mail's own instance, so the hook stays out of the HTML other code cleans with the shared one.
const mailPurifier = DOMPurify(window)
mailPurifier.addHook('uponSanitizeElement', unwrapStyleSheet)

// A received message's HTML, cleaned to what the reading pane renders.
export const sanitizeMail = (html: string) => mailPurifier.sanitize(html, MAIL_CONFIG)

// Plain text as HTML that keeps its shape.
//
// The breaks are <br> rather than a white-space style on the wrapper, because a quote the
// user opens in the composer goes through the editor, which keeps no style it has no
// attribute for and would run the whole body into one line. Leading indentation is nbsp for
// the same reason. A wrapper still carries pre-wrap, which is what preserves the runs of
// spaces inside a line for everyone who reads the message rather than edits it.
export const plainTextToHtml = (text: string) =>
  escapeHtml(text.replace(/\r\n?/g, '\n'))
    .split('\n')
    .map((line) => line.replace(/^ +/, (run) => '&nbsp;'.repeat(run.length)))
    .join('<br>')

export const hasHtmlContent = (content: string | null | undefined): boolean => {
  if (!content) return false
  return /<(html|head|body|div|p|span|table|td|tr|a|img|br|hr|h[1-6]|ul|ol|li|strong|em|b|i|font|style)[^>]*>/i.test(
    content,
  )
}
