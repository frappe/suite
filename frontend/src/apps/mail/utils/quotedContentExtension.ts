import { Node as TiptapNode } from '@tiptap/core'
import DOMPurify from 'dompurify'

/**
 * A mail carried into a reply or a forward — the `.frappe_mail_quote` / `.frappe_mail_fwd` block
 * that "show quoted content" folds into the body — is somebody else's document, and the editor's
 * schema used to flatten it: classes and attributes it doesn't know went, every table came out as
 * 25px min-width columns, and a newsletter forwarded twice arrived as a heap. This node carries the
 * block through the editor as one verbatim string instead, out of getHTML() exactly as it went in.
 *
 * The writer still edits it, as the HTML it is: the browser edits the block in place, and every
 * change is written back to the string. ProseMirror keeps out of it, since its schema is the very
 * thing that flattened the mail. Enter breaks out of the quoting, so an answer typed between
 * quoted lines is the writer's own, and the reader shows it rather than folding it away.
 */
export const QuotedContentExtension = TiptapNode.create({
  name: 'quotedContent',
  group: 'block',
  atom: true,
  addAttributes: () => ({ html: { default: '', rendered: false } }),
  parseHTML: () => [
    {
      tag: 'div.frappe_mail_quote, div.frappe_mail_fwd',
      // Above CustomParagraphExtension's bare `div` rule (50), which would otherwise claim the
      // wrapper. Raised on the rule, not the extension: an extension above the paragraph comes
      // first in the schema and so becomes the default block, which StarterKit's TrailingNode
      // then appends to every body — an empty, uneditable block that took the caret on a click
      // below the writing, and left a blank line at the end of every mail.
      priority: 60,
      getAttrs: (element) => ({ html: (element as HTMLElement).outerHTML }),
    },
  ],
  // A DOM node rather than a spec: the serializer appends it as is, so the markup never meets
  // the schema. Fresh each call — the serializer takes ownership of what it is handed. Not
  // sanitised, on purpose: this is the serialisation path (getHTML), and a quote the writer left
  // alone leaves exactly as it arrived, as it did before this node existed. One they edited leaves
  // as they saw it, the node view's sanitised copy. A <template>'s content is an inert document —
  // nothing in it runs or loads.
  renderHTML: ({ node }) => {
    const template = document.createElement('template')
    template.innerHTML = node.attrs.html
    return template.content.firstElementChild ?? ['div', {}]
  },
  addNodeView:
    () =>
    ({ node, editor, getPos }) => {
      // The quote's own wrapper is the editing host, so no edit can take off it the class the
      // reader and the send path know it by.
      const quote = displayed(node.attrs.html)
      quote.setAttribute('contenteditable', String(editor.isEditable))

      const dom = document.createElement('div')
      dom.setAttribute('contenteditable', 'false')
      dom.append(quote)

      let html = node.attrs.html
      const commit = () => {
        const pos = getPos()
        if (typeof pos !== 'number') return
        html = quote.outerHTML.replace(' contenteditable="true"', '')
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'html', html))
      }
      quote.addEventListener('input', commit)
      quote.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
        if (!breakOutOfQuote(quote)) return
        event.preventDefault()
        commit()
      })

      return {
        dom,
        update: (updated) => {
          if (updated.type !== node.type) return false
          // Its own edits are on screen already; an undo is the one change to redraw.
          if (updated.attrs.html !== html) {
            html = updated.attrs.html
            quote.innerHTML = displayed(html).innerHTML
          }
          return true
        },
        stopEvent: (event) => quote.contains(event.target as Node),
        ignoreMutation: () => true,
      }
    },
})

/**
 * Enter inside a quote ends the quoting at the caret: the quoted lines before it stay quoted, a
 * fresh line of the writer's own opens, and whatever followed the caret is quoted again below it —
 * the way Gmail and Apple Mail let you answer between someone's lines. False when the caret is not
 * in quoted text, so Enter there is the browser's own.
 */
export const breakOutOfQuote = (root: HTMLElement): boolean => {
  const selection = root.ownerDocument.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return false
  const caret = selection.getRangeAt(0)
  if (!root.contains(caret.startContainer)) return false

  // The outermost level, so the answer is the writer's and not quoted at any depth.
  let quote: Element | null = null
  for (let n: Node | null = caret.startContainer; n && n !== root; n = n.parentNode)
    if (n.nodeName === 'BLOCKQUOTE') quote = n as Element
  if (!quote) return false

  const rest = root.ownerDocument.createRange()
  rest.setStart(caret.startContainer, caret.startOffset)
  rest.setEndAfter(quote)
  const after = rest.extractContents()

  // A caret at the edge of a line leaves an empty shell of it on that side of the split.
  trimEdge(quote, 'lastChild')
  trimEdge(after, 'firstChild')

  const line = root.ownerDocument.createElement('div')
  line.append(root.ownerDocument.createElement('br'))
  quote.after(line)
  if (holdsContent(after)) line.after(after)
  if (!holdsContent(quote)) quote.remove()

  selection.collapse(line, 0)
  return true
}

// The quote as shown in the composer: sanitised, since it is foreign markup rendered in our own
// document.
const displayed = (html: string) => {
  const template = document.createElement('template')
  template.innerHTML = DOMPurify.sanitize(html)
  return (template.content.firstElementChild as HTMLElement | null) ?? document.createElement('div')
}

const VOID = new Set(['BR', 'IMG', 'HR'])

// Drop the empty nodes along one edge of `parent`, at every depth.
const trimEdge = (parent: Node, edge: 'firstChild' | 'lastChild') => {
  for (let child = parent[edge]; child; child = parent[edge]) {
    if (child.nodeType === Node.ELEMENT_NODE && !VOID.has(child.nodeName)) trimEdge(child, edge)
    const empty =
      child.nodeType === Node.TEXT_NODE
        ? !child.textContent
        : child.nodeType === Node.ELEMENT_NODE &&
          !VOID.has(child.nodeName) &&
          !child.hasChildNodes()
    if (!empty) return
    parent.removeChild(child)
  }
}

const holdsContent = (node: DocumentFragment | Element) =>
  !!node.textContent?.trim() || !!node.querySelector('img, table')
