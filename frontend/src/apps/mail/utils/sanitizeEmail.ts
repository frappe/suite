/**
 * The cleaning a sender's HTML goes through before anything of it reaches the screen or the
 * printer: one allow-list for both, so a message never prints with more than the reader shows —
 * no scripts, no forms, and none of the remote loads (`background`, `srcset`, `poster`, media)
 * the list leaves out. The whole document is kept, its `<head>` styles with it.
 */
import DOMPurify, { type UponSanitizeElementHook } from 'dompurify'

import { blockRemoteAssets } from '@/apps/mail/utils'
import { escapeBracketedAddresses } from '@/apps/mail/utils/html'

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

const DOMPURIFY_CONFIG = {
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

/**
 * `html` cleaned for display, as a whole document. Remote images and CSS urls are held back when
 * `blockRemote` is set — after sanitizing, so only markup the allow-list kept is looked at.
 */
export const sanitizeEmailHtml = (html: string, blockRemote: boolean): string => {
  const sanitized = mailPurifier.sanitize(escapeBracketedAddresses(html), DOMPURIFY_CONFIG)
  return blockRemote ? blockRemoteAssets(sanitized) : sanitized
}
