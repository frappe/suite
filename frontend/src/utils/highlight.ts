/**
 * A text cut where a search term hits it, so a row can mark what it was found by.
 *
 * Every word of the term is a hit on its own, since that is how the server matched: a search
 * for "board meeting" found rows that hold both words, not rows that hold the phrase, and a
 * highlight that wanted the phrase marked nothing on most of them. Case is ignored the way the
 * search ignores it. A term with no words cuts nothing.
 */
export type HighlightSegment = { text: string; hit: boolean }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function highlightSegments(text: string, term: string): HighlightSegment[] {
  const words = term.split(/\s+/).filter(Boolean)
  if (!text || !words.length) return text ? [{ text, hit: false }] : []
  // Longest first, so "meet" inside "meeting" is taken by the longer word where both were asked.
  const pattern = new RegExp(
    words
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'gi',
  )
  const segments: HighlightSegment[] = []
  let last = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) segments.push({ text: text.slice(last, match.index), hit: false })
    segments.push({ text: match[0], hit: true })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), hit: false })
  return segments
}

/** Marks the term's words in a document's text, as `highlightSegments` cuts it, each hit wrapped in
 * a `<mark>`. Text inside scripts, styles and form fields is left alone. */
export function highlightDocument(root: ParentNode & Node, term: string): void {
  if (!term.trim()) return
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest('script, style, textarea, title')
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const segments = highlightSegments(node.data, term)
    if (!segments.some((segment) => segment.hit)) continue
    const fragment = doc.createDocumentFragment()
    for (const segment of segments) {
      if (!segment.hit) {
        fragment.append(segment.text)
        continue
      }
      const mark = doc.createElement('mark')
      mark.textContent = segment.text
      fragment.append(mark)
    }
    node.replaceWith(fragment)
  }
}
