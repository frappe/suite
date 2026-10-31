/**
 * Marks the words a search found a message by in its body, each hit wrapped in a `<mark>`.
 *
 * Every word is a hit on its own, case ignored, as the server matched them and as the list marks
 * them (see utils/highlight, which a product can't import). Text inside scripts, styles and form
 * fields is left alone.
 */
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function highlightBody(root: ParentNode & Node, term: string): void {
  const words = term.split(/\s+/).filter(Boolean)
  if (!words.length) return
  // Longest first, so "meet" inside "meeting" is taken by the longer word where both were asked.
  const pattern = new RegExp(
    words
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|'),
    'gi',
  )
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
    const text = node.data
    const hits = [...text.matchAll(pattern)]
    if (!hits.length) continue
    const fragment = doc.createDocumentFragment()
    let last = 0
    for (const hit of hits) {
      fragment.append(text.slice(last, hit.index))
      const mark = doc.createElement('mark')
      mark.textContent = hit[0]
      fragment.append(mark)
      last = hit.index + hit[0].length
    }
    fragment.append(text.slice(last))
    node.replaceWith(fragment)
  }
}
