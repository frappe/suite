import { Extension, Mark, Node, type AnyExtension } from '@tiptap/core'
import { Mark as PMMark, type Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state'
import { AddMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from '@tiptap/pm/transform'
import { builtMarks } from '@tiptap/y-tiptap'
import { Code, CodeBlock, Heading, Image, ImageGroup, RichTextKit, Video } from 'frappe-ui/editor'

import ExtendedParagraph from '@/apps/writer/extensions/extended-paragraph'
import FontFamily from '@/apps/writer/extensions/font-family'
import { FontSize } from '@/apps/writer/extensions/font-size'
import { HeadingAnchors } from '@/apps/writer/extensions/heading-anchors'
import OldComment from '@/apps/writer/extensions/old-comment'
import { PageBreakExtension } from '@/apps/writer/extensions/page-break'
import { isReceived } from '@/apps/writer/extensions/received-content-guard'

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
        renderHTML: (attrs) => (attrs.order === null ? {} : { 'data-tab-order': attrs.order }),
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

// Kinds a merge can leave holding nothing; the collab binding hides such a leftover instead of freezing
const HIDDEN_WHEN_EMPTY = new Set([
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'blockquote',
  'paragraph',
  'imageGroup',
])

export const HiddenWhenEmpty = Extension.create({
  name: 'hiddenWhenEmpty',

  extendNodeSchema(extension) {
    return { hiddenWhenEmpty: HIDDEN_WHEN_EMPTY.has(extension.name) }
  },
})

export const WRITER_STARTER_KIT = { paragraph: false } as const

const KEPT_FORMATTING = 'keptFormatting'

// Every Writer mark but kept formatting, which code text may carry
const CODE_EXCLUDES = 'link textStyle bold italic strike underline code namedHighlight comment'

const WriterCode = Code.extend({ excludes: CODE_EXCLUDES })

const WriterCodeBlock = CodeBlock.extend({ marks: KEPT_FORMATTING })

function writerVersion(extension: AnyExtension) {
  if (extension.name === 'code') {
    return WriterCode
  }

  return extension.name === 'codeBlock' ? WriterCodeBlock : extension
}

// RichTextKit with code that may carry kept formatting
export const WriterKit = RichTextKit.extend({
  addExtensions() {
    return (this.parent?.() ?? []).map(writerVersion)
  },
})

// A kept mark this transaction brought in that the document didn't hold before
function isNewKept(mark: PMMark, before: PMMark[]) {
  return isKept(mark) && !before.some((old) => mark.eq(old))
}

function isKept(mark: PMMark) {
  return mark.type.name === KEPT_FORMATTING
}

function keptMarks(state: EditorState) {
  const marks: PMMark[] = []
  state.doc.descendants((node) => {
    marks.push(...node.marks.filter((mark) => mark.type.name === KEPT_FORMATTING))
  })
  return marks
}

function bringsKept(step: Step) {
  if (step instanceof AddMarkStep) {
    return step.mark.type.name === KEPT_FORMATTING
  }

  if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
    return false
  }

  let isFound = false
  step.slice.content.descendants((node) => {
    isFound ||= node.marks.some((mark) => mark.type.name === KEPT_FORMATTING)
    return !isFound
  })
  return isFound
}

function isOwnKeptWrite(tr: Transaction) {
  return !isReceived(tr) && tr.steps.some(bringsKept)
}

// Remove kept formatting a local change brought in, so only the collab binding makes it
function stripNewKept(tr: Transaction, before: EditorState) {
  const old = keptMarks(before)
  tr.doc.descendants((node, position) => {
    for (const mark of node.marks) {
      if (isNewKept(mark, old)) {
        tr.removeMark(position, position + node.nodeSize, mark)
      }
    }
  })
}

// The part of `after` that differs from `before`
function changedRange(before: PMNode, after: PMNode) {
  const from = before.content.findDiffStart(after.content)
  const end = before.content.findDiffEnd(after.content)
  if (from === null || end === null) {
    return null
  }

  return { from, to: Math.max(from, end.b) }
}

// Give changed text the marks a build from Yjs would, so kept formatting that can now show does
function showKept(tr: Transaction, before: EditorState) {
  const range = changedRange(before.doc, tr.doc)
  if (!range) {
    return
  }

  const { doc } = tr
  doc.nodesBetween(range.from, range.to, (node, position, parent) => {
    if (!node.isText || !parent || !node.marks.some(isKept)) {
      return
    }

    const marks = builtMarks(node.marks, parent.type, doc.type.schema)
    if (!PMMark.sameSet(marks, node.marks)) {
      const end = position + node.nodeSize
      tr.removeMark(position, end)
      for (const mark of marks) {
        tr.addMark(position, end, mark)
      }
    }
  })
}

function isOwnChange(tr: Transaction) {
  return tr.docChanged && !isReceived(tr)
}

const keptKey = new PluginKey('keptFormatting')

// Strip kept formatting a local change brought in, and show what a local change made showable
function settleKept(transactions: readonly Transaction[], before: EditorState, after: EditorState) {
  const tr = after.tr
  if (transactions.some(isOwnKeptWrite)) {
    stripNewKept(tr, before)
  }

  if (transactions.some(isOwnChange)) {
    showKept(tr, before)
  }

  return tr.docChanged ? tr : null
}

// Exclusive marks a build from Yjs shows ahead of the rest: a link, then code
const KEPT_SPEC = { shownFirst: ['link', 'code'] }

// Formatting a collaborator's text holds that Writer can't show where it sits; the collab binding
// builds it from Yjs and writes its keys back as they were
export const KeptFormatting = Mark.create({
  name: KEPT_FORMATTING,
  inclusive: false,

  addAttributes() {
    return { attributes: { default: {}, rendered: false } }
  },

  renderHTML() {
    return ['span', 0]
  },

  addProseMirrorPlugins() {
    return [new Plugin({ key: keptKey, appendTransaction: settleKept })]
  },

  extendMarkSchema(extension) {
    if (extension.name === KEPT_FORMATTING) {
      return KEPT_SPEC
    }

    return {}
  },
})

export const writerSchema = () => [
  WriterKit.configure({
    // A preview shows the stored content as is, with no paragraph appended
    starterKit: { ...WRITER_STARTER_KIT, trailingNode: false },
    heading: false,
    image: false,
    video: false,
  }),
  Image,
  ImageGroup,
  Video,
  Heading,
  FontSize,
  FontFamily,
  EmbedNode,
  ExtendedParagraph,
  PageBreakExtension,
  TabNode,
  OldComment,
  HeadingAnchors,
  HiddenWhenEmpty,
  KeptFormatting,
]
