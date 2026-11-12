import { Node, type AnyExtension } from '@tiptap/core'
import { TextStyleKit } from '@tiptap/extension-text-style'
import { Fragment } from '@tiptap/pm/model'
import { useFileUpload } from 'frappe-ui'
import { Heading, Image, ImageGroup, ImageViewer, RichTextKit } from 'frappe-ui/editor'

import { randomString } from '@/apps/mail/utils'

export const CustomParagraphExtension = Node.create({
  name: 'paragraph',
  priority: 1000,
  group: 'block',
  content: 'inline*',
  parseHTML: () => [
    // A mail's blank line, `<div><br></div>`, is an empty paragraph: read as a paragraph holding a
    // line break it would be drawn two lines tall, and come back out with the break doubled.
    {
      tag: 'div',
      getAttrs: (element) =>
        element.childNodes.length === 1 && element.firstChild?.nodeName === 'BR' ? null : false,
      getContent: () => Fragment.empty,
    },
    { tag: 'div' },
    { tag: 'p' },
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
