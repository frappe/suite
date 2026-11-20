import { Node as TiptapNode, type AnyExtension } from '@tiptap/core'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { useFileUpload } from 'frappe-ui'
import { Heading, Image, ImageGroup, ImageViewer, RichTextKit } from 'frappe-ui/editor'

import { randomString } from '@/apps/mail/utils'

/**
 * A line of a mail body is a `<div>`, and a browser draws a `<br>` that ends one as nothing: a line
 * ending in a break is one line tall, an empty one has no height at all. The editor draws both as a
 * blank line. So a line read in loses its last trailing break, and a line written out that is empty
 * or ends in a break gains one, each the other's inverse. What the writer saw as a blank line is
 * then one in the sent mail and in every client that reads it.
 */
const BLOCK =
  /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|OL|P|PRE|SECTION|TABLE|UL)$/

// The `<br>` a line ends in, if it ends in one: the last thing in it, through any inline wrapper
// around it (a bold or a font). None in a block that holds other blocks — that is not one line.
const trailingBreak = (line: Element): ChildNode | null => {
  if (Array.from(line.querySelectorAll('*')).some((el) => BLOCK.test(el.nodeName))) return null
  let last = line.lastChild
  while (last) {
    if (last.nodeType === Node.TEXT_NODE && !last.textContent) last = last.previousSibling
    else if (last.nodeName === 'BR') return last
    else if (last.nodeType === Node.ELEMENT_NODE && last.lastChild) last = last.lastChild
    else return null
  }
  return null
}

/** A body as the editor wrote it, its blank lines as every mail client draws them. */
export const withBlankLines = (html: string) => {
  const template = document.createElement('template')
  template.innerHTML = html
  // A quote is somebody else's mail and leaves as it came (see QuotedContentExtension).
  const lines = Array.from(template.content.querySelectorAll('div')).filter(
    (line) => !line.closest('.frappe_mail_quote, .frappe_mail_fwd'),
  )
  for (const line of lines) {
    if (!line.hasChildNodes()) line.append(document.createElement('br'))
    else trailingBreak(line)?.after(document.createElement('br'))
  }
  return template.innerHTML
}

// The line as the editor reads it: its last trailing break dropped, since that is what a browser
// draws. A blank line, `<div><br></div>`, so reads as an empty paragraph, not one holding a break.
const asDrawn = (element: HTMLElement) => {
  const line = element.cloneNode(true)
  if (!(line instanceof HTMLElement)) return element
  const lineBreak = trailingBreak(line)
  if (!lineBreak) return element
  lineBreak.remove()
  return line
}

export const CustomParagraphExtension = TiptapNode.create({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  parseHTML: () => [
    { tag: 'div', contentElement: asDrawn },
    { tag: 'p', contentElement: asDrawn },
  ],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes, 0],
})

export const uploadFunction = async (file: File) =>
  useFileUpload().upload(file, {
    private: true,
    folder: 'Home/Frappe Mail',
    upload_endpoint: '/api/method/suite.mail.api.mail.upload_file',
  })

/**
 * Images carry a `data-cid` so the send path can turn them into inline attachments — stamped here,
 * on the way into the document, for any image that came from our own uploads.
 */
export const CustomImageExtension = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-cid': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-cid'),
        renderHTML: (attributes: Record<string, string>) => {
          const src = attributes.src || ''
          if (
            !attributes['data-cid'] &&
            (src.startsWith('/files') || src.startsWith('/private/files'))
          )
            attributes['data-cid'] = randomString(10)
          return { 'data-cid': attributes['data-cid'] }
        },
      },
    }
  },
}).configure({
  HTMLAttributes: { width: '600', style: 'max-width:100%; height:auto' },
  uploadFunction,
})

// Signature and vacation images, which have no mail to be attached to.
export const uploadPrivateFile = (file: File) => useFileUpload().upload(file, { private: true })

/**
 * The extensions every Mail editor is built from. `divParagraphs` is the mail-body form, a line as
 * `<div>`; the vacation message has always been kept as `<p>`.
 */
export const mailEditorKit = ({
  image = Image,
  divParagraphs = true,
}: { image?: AnyExtension; divParagraphs?: boolean } = {}): AnyExtension[] => [
  RichTextKit.configure({
    starterKit: divParagraphs ? { paragraph: false } : {},
    // The kit's heading stamps table-of-contents ids that would go out in the mail; the plain one
    // is added back below.
    heading: false,
    // Mail's image takes the kit's group and viewer down with it, so those are added back below.
    image: false,
    // A mail's files sit beside its body as attachments, never inside it.
    attachment: false,
    // A mail can't carry an embed: mail clients strip iframes. A pasted link stays a link.
    iframe: false,
    // The composer brings its own `@`, searching the account's contacts.
    mention: false,
    tag: false,
  }),
  Heading,
  image,
  ImageGroup,
  ImageViewer,
  // A signature's or a pasted paragraph's font, which the kit's own text style would drop.
  TextStyleKit.configure({ textStyle: false, backgroundColor: false, color: false }),
  ...(divParagraphs ? [CustomParagraphExtension] : []),
]
