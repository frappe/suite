import DOMPurify from 'dompurify'
import { Marked } from 'marked'

// An own instance, so these rules leave the shared `marked` alone: frappe-ui's
// editor uses that one to read pasted Markdown.
const markdown = new Marked({
  gfm: true,
  renderer: {
    // HTML written in the file shows as text. It is never parsed as markup.
    html: ({ text, block }) => (block ? `<p>${escapeHtml(text)}</p>` : escapeHtml(text)),
  },
})

// An own instance too: its hook below must not touch the HTML other code
// cleans with the shared one, such as frappe-ui's toasts.
const purify = DOMPurify(window)

// The hook runs inside DOMPurify's own document, which is inert: nothing in it
// loads or runs while links and images are fixed up.
purify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element)) return
  if (node.tagName === 'A') {
    const href = node.getAttribute('href')
    // A link the cleaning left without an address, such as a `javascript:` one, shows as its text.
    if (href === null) node.replaceWith(...node.childNodes)
    // A link to a place in the file stays in the tab.
    else if (href.startsWith('#')) node.removeAttribute('target')
    else {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
  } else if (node.tagName === 'IMG') {
    if (isRemoteImage(node.getAttribute('src'))) {
      node.setAttribute('referrerpolicy', 'no-referrer')
      node.setAttribute('loading', 'lazy')
    } else {
      node.replaceWith(node.getAttribute('alt') ?? '')
    }
  }
})

/**
 * A Markdown file as HTML that is safe to show on the app's origin. Raw HTML
 * in the file stays text. The cleaned output has no script, event handler,
 * style or form, and no `javascript:` link. Links to other pages open in a new
 * tab; links to a place in the file do not.
 */
export function renderMarkdown(text: string): string {
  return purify.sanitize(markdown.parse(text, { async: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['style'],
  })
}

/**
 * Only HTTPS images from another site load. A relative or same-site address
 * would send a request to Suite itself with the viewer's session, and a plain
 * HTTP one would be mixed content.
 */
function isRemoteImage(src: string | null): boolean {
  if (!src) return false
  try {
    const url = new URL(src, window.location.href)
    return url.protocol === 'https:' && url.origin !== window.location.origin
  } catch {
    return false
  }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}
