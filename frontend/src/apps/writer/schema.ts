import { Node } from '@tiptap/core'
import { Heading, RichTextKit } from 'frappe-ui/editor'
import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import OldComment from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'

// Every node and mark a Writer document can hold, without node views or editor
// behaviour, so code that only reads or checks documents can build the schema

export const TabNode = Node.create({
  name: 'tab',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-tab-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-tab-id': attrs.id } : {}),
      },
      label: {
        default: 'Untitled',
        parseHTML: (el) => el.getAttribute('data-tab-label'),
        renderHTML: (attrs) => ({ 'data-tab-label': attrs.label }),
      },
      order: {
        default: null,
        parseHTML: (el) => {
          const order = el.getAttribute('data-tab-order')
          return order === null ? null : Number(order)
        },
        renderHTML: (attrs) =>
          attrs.order === null ? {} : { 'data-tab-order': attrs.order },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-tab-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes, 0]
  },
})

export const EmbedNode = Node.create({ name: 'embed' })

export const WRITER_STARTER_KIT = { paragraph: false } as const

export const writerSchema = () => [
  RichTextKit.configure({ starterKit: WRITER_STARTER_KIT, heading: false }),
  Heading,
  FontSize,
  FontFamily,
  EmbedNode,
  ExtendedParagraph,
  PageBreakExtension,
  TabNode,
  OldComment,
  HeadingAnchors,
]
