import DOMPurify from 'dompurify'
import { Marked } from 'marked'

/**
 * Heading ids carry a prefix, so a heading in a file can never take the id of
 * an element of the app, or of a property `document` or `window` names.
 */
const PLACE_PREFIX = 'md-'

/** The ids the file being rendered has used, with how often. `renderMarkdown` starts it afresh. */
let usedIds = new Map<string, number>()

// An own instance, so these rules leave the shared `marked` alone: frappe-ui's
// editor uses that one to read pasted Markdown.
const markdown = new Marked({
  gfm: true,
  renderer: {
    // HTML written in the file shows as text. It is never parsed as markup.
    html: ({ text, block }) => (block ? `<p>${escapeHtml(text)}</p>` : escapeHtml(text)),
    // Each heading gets the id a GitHub link to it uses, so `[Setup](#setup)` finds it.
    heading({ tokens, depth }) {
      const inner = this.parser.parseInline(tokens)
      return `<h${depth} id="${PLACE_PREFIX}${uniqueId(slug(inner))}">${inner}</h${depth}>\n`
    },
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
    // Remote images load on purpose, as on GitHub; they go without a referrer, and browsers send no cookies except SameSite=None ones.
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
  usedIds = new Map()
  return purify.sanitize(markdown.parse(text, { async: false }), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form'],
    FORBID_ATTR: ['style'],
  })
}

/**
 * The heading a link to a place in the file goes to, such as `#setup`, in the
 * HTML `renderMarkdown` made. `null` when the file has no such heading.
 */
export function placeFor(root: ParentNode, href: string): HTMLElement | null {
  let place: string
  try {
    place = decodeURIComponent(href.replace(/^#/, ''))
  } catch {
    return null
  }
  const id = PLACE_PREFIX + place
  return [...root.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].find((heading) => heading.id === id) ?? null
}

/** GitHub's slug for a heading: its text in lower case, punctuation dropped, spaces as hyphens. */
function slug(html: string): string {
  const text = unescapeHtml(html.replace(/<[^>]*>/g, ''))
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-')
}

/** A second heading with the same slug gets `-1`, a third `-2`, as on GitHub. */
function uniqueId(base: string): string {
  const count = usedIds.get(base) ?? 0
  usedIds.set(base, count + 1)
  return count ? `${base}-${count}` : base
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

const UNESCAPES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

function unescapeHtml(html: string): string {
  return html.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => UNESCAPES[entity] ?? entity)
}
