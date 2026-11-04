import { generateJSON, getSchema } from '@tiptap/core'
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model'
import { Transform } from '@tiptap/pm/transform'
import {
  placeFragment,
  prosemirrorToYXmlFragment,
  ySyncPluginKey,
  yXmlFragmentToProseMirrorRootNode,
} from '@tiptap/y-tiptap'
import {
  applyUpdate,
  ContentDeleted,
  ContentEmbed,
  ContentFormat,
  ContentString,
  ContentType,
  decodeUpdateV2,
  Doc,
  encodeStateAsUpdate,
  equalSnapshots,
  Item,
  snapshot,
  XmlElement,
  XmlFragment,
  XmlText,
  type AbstractStruct,
  type AbstractType,
} from 'yjs'

import { BODY_FIELD } from '@/apps/writer/collab/field'
import {
  domInventory,
  inventory,
  NOISE_ATTRIBUTES,
  OVERLAP_SUFFIX,
  rawStyles,
  unkept,
  type Inventory,
} from '@/apps/writer/collab/inventory'
import {
  isAtomName,
  isContent,
  isHintOnlyToc,
  MEDIA,
  readLegacy,
  type LegacyBody,
  type LegacyRead,
} from '@/apps/writer/collab/legacy-read'
import {
  ANNOTATION_TAG,
  bodyUnits,
  dropCommentMarks,
  listedComments,
  markedIds,
  markOldThreads,
  oldCommentAnchors,
  oldRanges,
  rangeAnchors,
  unreadableThreads,
  wordAnchors,
  type ListedComment,
} from '@/apps/writer/collab/old-comments'
import {
  convertOldMedia,
  isFloatDropped,
  isOldLayout,
  isOldMediaMappable,
  oldLayout,
} from '@/apps/writer/collab/old-media'
import {
  breaksStyle,
  DRIVE_INK,
  dropEmptyFonts,
  dropUnclosedFonts,
  mapOldCellStyles,
  mapOldColours,
  moveSpanHighlights,
  readOldHighlights,
  readOldTextColours,
  repairHtmlCellSpans,
  repairOldCellSpans,
} from '@/apps/writer/collab/old-styles'
import { readOldThreads, type OldComment } from '@/apps/writer/collab/old-threads'
import { placeThread } from '@/apps/writer/collab/places'
import { writerRender } from '@/apps/writer/collab/render'
import { tabEditor } from '@/apps/writer/collab/tab-editor'
import { DRIVE_HEADING_LINE_HEIGHT, INDENTED_BLOCKS } from '@/apps/writer/extensions/block-layout'
import { renderedIds } from '@/apps/writer/extensions/heading-anchors'
import { writerSchema } from '@/apps/writer/schema'
import { isSameColour } from '@/apps/writer/utils/css-colour'

const extensions = writerSchema()
const schema = getSchema(extensions)

/**
 * What the conversion couldn't carry over: Drive's table of contents, rebuilt from the headings, a
 * part holding nothing, a change Yjs held back, the words of an old comment's copy away from its
 * anchor, the place of an old comment whose words are gone, a Yjs body holding nothing, read past
 * for the HTML, a property or attribute on the noise list, or the count of table cell spans set
 * to the span a browser drew.
 */
export type Dropped =
  | { kind: 'toc-hint' }
  | { kind: 'empty'; name: string }
  | { kind: 'pending'; text: string; parts: string[] }
  | { kind: 'comment-copy'; id: string; text: string }
  | { kind: 'comment-deleted'; id: string }
  | { kind: 'empty-yjs' }
  | { kind: 'noise'; name: string }
  | { kind: 'table-span'; count: number }

/** A thread Drive kept only in its 2023 comment marks, under a key its far copies name */
export interface OldThread {
  key: string
  anchor: string
  comments: OldComment[]
}

export type Converted =
  | {
      kind: 'converted'
      state: Uint8Array
      html: string
      dropped: Dropped[]
      from: 'yjs' | 'html'
      anchors: Record<string, string>
      threads: OldThread[]
    }
  | { kind: 'failed'; reason: 'too_large' | 'check' | 'unreadable-yjs' }

function insertedString(struct: AbstractStruct) {
  if (struct instanceof Item && struct.content instanceof ContentString) {
    return struct.content.str
  }

  return ''
}

function nameOf(type: AbstractType<unknown>) {
  if (type instanceof XmlElement) {
    return type.nodeName
  }

  return 'text'
}

// What a held-back change adds besides text: a part, a mark or an embed
function pendingPart(struct: AbstractStruct) {
  if (!(struct instanceof Item)) {
    return []
  }

  const { content } = struct
  if (content instanceof ContentType) {
    return [nameOf(content.type)]
  }

  // A mark's end is stored as the same key set to null
  if (content instanceof ContentFormat && content.value !== null) {
    return [`format ${content.key}`]
  }

  if (content instanceof ContentEmbed) {
    return ['embed']
  }

  const isTextOrNone = [ContentString, ContentDeleted, ContentFormat].some(
    (kind) => content instanceof kind,
  )
  if (isTextOrNone) {
    return []
  }

  return ['other']
}

// Changes Yjs keeps waiting, in its V2 encoding, for earlier ones that were never stored
function pendingDrop(doc: Doc): Dropped[] {
  const pending = doc.store.pendingStructs
  if (!pending) {
    return []
  }

  const { structs } = decodeUpdateV2(pending.update)
  const text = structs.map(insertedString).join('')
  const parts = [...new Set(structs.flatMap(pendingPart))]
  if (!text && !parts.length) {
    return []
  }

  return [{ kind: 'pending', text, parts }]
}

// A lost part holds content when it, or anything in it, is text, an atom or a stored attribute
function holdsContent(part: AbstractType<unknown>) {
  if (isContent(part)) {
    return true
  }

  return part instanceof XmlElement && !part.createTreeWalker(isContent).next().done
}

function isDroppable(part: AbstractType<unknown>) {
  return isHintOnlyToc(part) || !holdsContent(part)
}

function droppedPart(part: AbstractType<unknown>): Dropped {
  if (isHintOnlyToc(part)) {
    return { kind: 'toc-hint' }
  }

  return { kind: 'empty', name: nameOf(part) }
}

// The id each heading's anchor already has when drawn, so links to it keep working
function withHeadingIds(node: PMNode) {
  const nextRenderedId = renderedIds()
  const transform = new Transform(node)
  node.descendants((child, pos) => {
    const isBare =
      child.type.name === 'heading' && !!child.textContent && !child.attrs['data-toc-id']
    if (isBare) {
      transform.setNodeAttribute(pos, 'data-toc-id', nextRenderedId(child.textContent))
    }
  })
  return transform.doc
}

// Where each image and video points, in order
function mediaSources(body: XmlFragment) {
  const media = [
    ...body.createTreeWalker((type) => type instanceof XmlElement && MEDIA.has(type.nodeName)),
  ] as XmlElement[]
  return JSON.stringify(media.map((element) => element.getAttribute('src')))
}

const INDENTED = new Set(INDENTED_BLOCKS)

function elementsOf(body: XmlFragment) {
  return [...body.createTreeWalker((type) => type instanceof XmlElement)] as XmlElement[]
}

// Drive stored its indent and heading line height at defaults it never drew
function dropDriveDefaults(body: XmlFragment) {
  for (const element of elementsOf(body)) {
    const indent: unknown = element.getAttribute('indent')
    if (INDENTED.has(element.nodeName) && indent === 0) {
      element.removeAttribute('indent')
    }

    const lineHeight = element.getAttribute('lineHeight')
    if (element.nodeName === 'heading' && lineHeight === DRIVE_HEADING_LINE_HEIGHT) {
      element.removeAttribute('lineHeight')
    }
  }
}

// An old mark holding no attributes may be stored as true, which the editor reads as that mark
function readTrueRuns(text: XmlText) {
  let at = 0
  const runs = text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]
  for (const { insert, attributes = {} } of runs) {
    let length = 1
    if (typeof insert === 'string') {
      length = insert.length
    }

    const trueMarks = Object.keys(attributes).filter(
      (key) =>
        attributes[key] === true &&
        Object.hasOwn(schema.marks, key) &&
        !Object.keys(schema.marks[key].spec.attrs ?? {}).length,
    )
    if (trueMarks.length) {
      text.format(at, length, Object.fromEntries(trueMarks.map((key) => [key, {}])))
    }

    at += length
  }
}

function readTrueMarks(body: XmlFragment) {
  const texts = [...body.createTreeWalker((type) => type instanceof XmlText)] as XmlText[]
  for (const text of texts) {
    readTrueRuns(text)
  }
}

// Drive stored an indent only as a whole number of pixels
function hasWholeIndents(body: XmlFragment) {
  return elementsOf(body).every((element) => {
    const indent: unknown = element.getAttribute('indent')
    return indent == null || Number.isInteger(indent)
  })
}

// frappe-ui left its upload id on uploaded media, which opens the caption field where it's drawn
function dropUploadIds(body: XmlFragment): Dropped[] {
  const marked = [
    ...body.createTreeWalker(
      (type) =>
        type instanceof XmlElement &&
        MEDIA.has(type.nodeName) &&
        type.getAttribute('uploadId') != null,
    ),
  ] as XmlElement[]
  for (const element of marked) {
    element.removeAttribute('uploadId')
  }

  if (!marked.length) {
    return []
  }

  return [{ kind: 'noise', name: 'uploadId' }]
}

// Drive's mention stored its author and kind, which it never drew; its words stay
const UNDRAWN_MENTION_KEYS = ['author', 'type']

function dropMentionData(body: XmlFragment): Dropped[] {
  const mentions = elementsOf(body).filter(({ nodeName }) => nodeName === 'mention')
  const dropped: Dropped[] = []
  for (const name of UNDRAWN_MENTION_KEYS) {
    const held = mentions.filter((mention) => mention.getAttribute(name) != null)
    for (const mention of held) {
      mention.removeAttribute(name)
    }

    if (held.length) {
      dropped.push({ kind: 'noise', name })
    }
  }

  return dropped
}

function isDeclaredAtomKey(name: string, key: string) {
  const declared = schema.nodes[name].spec.attrs ?? {}
  return Object.hasOwn(declared, key) || key.replace(OVERLAP_SUFFIX, '') in schema.marks
}

// A key on an atom naming neither its attribute nor a mark would be carried along and never drawn
function hasDeclaredAtomKeys(body: XmlFragment) {
  return elementsOf(body)
    .filter(({ nodeName }) => isAtomName(nodeName))
    .every((atom) =>
      Object.entries(atom.getAttributes()).every(
        ([key, value]) => value == null || isDeclaredAtomKey(atom.nodeName, key),
      ),
    )
}

// The old editor showed old media's alignment over its float, so a float beside one goes
function droppedFloats(body: XmlFragment): Dropped[] {
  if (!isFloatDropped(body)) {
    return []
  }

  return [{ kind: 'noise', name: 'dataFloat' }]
}

// The check compares the old body with the fresh one as Yjs holds both. Between them:
// convertOldMedia, checked on its own by where the media points and by old media holding only what
// the old editor wrote; a float beside an alignment, dropped (recorded); Drive's defaults, dropped;
// a mark stored as true where the mark holds no attributes, read as that mark; frappe-ui's upload
// id on media, dropped (recorded); Drive's mention author and type, dropped (recorded); an atom key
// Writer doesn't declare, or the check fails; old colours, read as palette names, or the check
// fails; a font family ending in a ';', read before it; cell styles, read as pasted HTML is, or the
// check fails; the parts the build set aside holding nothing, hidden or lost (recorded), and
// Drive's table of contents holding only its hint, left out of the source, so a lost part with
// content fails; and the extras the result may hold, being the filler the build adds, declared
// defaults and heading ids
function fromYjs(old: Doc) {
  const body = old.getXmlFragment(BODY_FIELD)
  const threads = markOldThreads(body, schema)
  const hasUnreadableThreads = !threads || unreadableThreads(old).length > 0
  const media = mediaSources(body)
  const isOldMediaKept = isOldMediaMappable(body)
  const floats = droppedFloats(body)
  convertOldMedia(body)
  dropDriveDefaults(body)
  readTrueMarks(body)
  const isIndentKept = hasWholeIndents(body)
  const uploadIds = dropUploadIds(body)
  const mentionData = dropMentionData(body)
  const isAtomDeclared = hasDeclaredAtomKeys(body)
  const isColourMapped = mapOldColours(body)
  const isCellStyleMapped = mapOldCellStyles(body)
  const repairedSpans = repairOldCellSpans(body)
  const { node, hidden, lost } = placeFragment(body, schema)
  const isMediaKept = mediaSources(body) === media
  const setAside = [...hidden, ...lost.filter(isDroppable)]
  const source = inventory(body, new Set(setAside))
  return {
    node,
    dropped: [...setAside.map(droppedPart), ...pendingDrop(old)],
    hasUnreadableThreads,
    threads: threads?.threads ?? [],
    check: (fresh: XmlFragment): Dropped[] | null => {
      const isKept =
        lost.every(isDroppable) &&
        isColourMapped &&
        isCellStyleMapped &&
        isAtomDeclared &&
        isIndentKept &&
        isMediaKept &&
        isOldMediaKept &&
        !unkept(source, inventory(fresh)).length
      if (!isKept) {
        return null
      }

      return [
        ...uploadIds,
        ...floats,
        ...mentionData,
        ...droppedImages(threads),
        ...droppedSpans(repairedSpans),
      ]
    },
  }
}

// The units each listed comment covers in the old body, read before anything rewrites it, then
// placed on the same units of the fresh body; a mark wins over its listing
function placeRanges(old: Doc, comments: ListedComment[]) {
  const body = old.getXmlFragment(BODY_FIELD)
  const marked = markedIds(body, schema)
  const listed = comments.filter(({ id }) => !marked.has(id))
  if (!listed.length) {
    return { marked, placeListed: () => ({ anchors: {}, deleted: [] }) }
  }

  const units = bodyUnits(body, schema)
  const ranges = oldRanges(old, units, listed)
  function placeListed(fresh: XmlFragment) {
    const freshUnits = bodyUnits(fresh, schema)
    const anchors =
      ranges && rangeAnchors(fresh, schema, { old: units, fresh: freshUnits }, ranges.ranges)
    return anchors && { anchors, deleted: ranges.deleted }
  }

  return { marked, placeListed }
}

const atomRules = Object.values(schema.nodes)
  .filter((type) => isAtomName(type.name))
  .flatMap((type) => (type.spec.parseDOM ?? []).map((rule) => ({ rule, name: type.name })))

function atomNameOf(element: Element) {
  const found = atomRules.find(
    ({ rule }) => element.matches(rule.tag) && rule.getAttrs?.(element as HTMLElement) !== false,
  )
  return found?.name
}

// Whether a parent still sets a colour, which the editor would draw on Drive's ink inside it;
// parents are stripped first, and inherit sets none
function hasColouredAncestor(element: HTMLElement) {
  let parent = element.parentElement
  while (parent) {
    const color = parent.style.getPropertyValue('color')
    if (color && color !== 'inherit') {
      return true
    }

    parent = parent.parentElement
  }

  return false
}

// The id and look Drive wrote on every page break, which the editor draws by its data attribute
const DRIVE_PAGE_BREAK_ID = 'page-break-div'
const DRIVE_PAGE_BREAK_STYLE =
  'page-break-after: always; border: 2px dashed lightgray; margin: 25px 0px;'

// Drive stored its indent and start alignment on paragraphs and headings, its heading line height
// and its ink on default text, all at their defaults; a highlight also kept its colour in data-color, which the
// editor reads from the style, so it goes only when it's the same colour; a video repeated its src
// in a source; and a page break held Drive's id and look, which go only when written exactly so
function dropDriveHtmlDefaults(body: HTMLElement) {
  for (const block of body.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6')) {
    if (block.style.getPropertyValue('margin-left') === '0px') {
      block.style.removeProperty('margin-left')
    }

    if (block.style.getPropertyValue('text-align') === 'start') {
      block.style.removeProperty('text-align')
    }
  }

  for (const heading of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    if (heading.style.getPropertyValue('line-height') === DRIVE_HEADING_LINE_HEIGHT) {
      heading.style.removeProperty('line-height')
    }
  }

  for (const element of body.querySelectorAll<HTMLElement>('[style]')) {
    if (element.style.getPropertyValue('color') === DRIVE_INK && !hasColouredAncestor(element)) {
      element.style.removeProperty('color')
    }
  }

  for (const mark of body.querySelectorAll<HTMLElement>('mark[data-color]')) {
    const background = mark.style.getPropertyValue('background-color')
    if (background && isSameColour(background, mark.getAttribute('data-color') ?? '')) {
      mark.removeAttribute('data-color')
    }
  }

  for (const source of body.querySelectorAll('video > source')) {
    if (source.getAttribute('src') === source.parentElement?.getAttribute('src')) {
      source.remove()
    }
  }

  for (const pageBreak of body.querySelectorAll('div[data-page-break="true"]')) {
    const isDrives =
      pageBreak.id === DRIVE_PAGE_BREAK_ID &&
      pageBreak.getAttribute('style') === DRIVE_PAGE_BREAK_STYLE
    if (isDrives) {
      pageBreak.removeAttribute('id')
      pageBreak.removeAttribute('style')
    }
  }
}

// The old editor's resizable media, whose kind agrees with its tag and whose layout is under its own names
const UNNAMED = ':not([data-align]):not([data-float])'
const OLD_MEDIA = `img[media-type="img"]${UNNAMED}, video[media-type="video"]${UNNAMED}`

// Old resizable media laid out as the old editor showed it, under the names the editor reads; its
// kind goes, since the tag says it, so a disagreeing kind, a layout under both names or a layout
// the old editor never wrote fails the check
function mapOldMedia(body: HTMLElement) {
  const olds = [...body.querySelectorAll(OLD_MEDIA)].filter((old) =>
    isOldLayout(old.getAttribute('dataalign'), old.getAttribute('datafloat')),
  )
  for (const old of olds) {
    const { align, float } = oldLayout(old.getAttribute('dataalign'), old.getAttribute('datafloat'))
    old.setAttribute('data-align', align)
    if (float) {
      old.setAttribute('data-float', float)
    }

    for (const name of ['media-type', 'dataalign', 'datafloat']) {
      old.removeAttribute(name)
    }
  }

  return olds.length > 0
}

// The old editor showed old media's alignment over its float, so a float beside one goes
function droppedHtmlFloats(body: HTMLElement) {
  const olds = [...body.querySelectorAll(OLD_MEDIA)]
  if (!olds.some((old) => old.hasAttribute('dataalign') && old.hasAttribute('datafloat'))) {
    return []
  }

  return ['datafloat']
}

// The HTML the editor reads, its old media mapped and its colours and empty fonts read in place as
// on the Yjs path; written back from the parse only when that, moving a span's background or the
// caller changed it. Text goes first, so a mark whose text colour is see-through can unwrap
function readableHtml(body: HTMLElement, html: string, isRewritten: boolean) {
  const reads = [readOldTextColours(body), readOldHighlights(body), dropEmptyFonts(body)]
  const isMapped = mapOldMedia(body)
  const readable = body.cloneNode(true) as HTMLElement
  const isMoved = moveSpanHighlights(readable)
  if (!reads.includes(true) && !isMoved && !isMapped && !isRewritten) {
    return html
  }

  return readable.innerHTML
}

// frappe-ui wrote its upload marks on media but forced them to null when reading HTML, so no
// reader drew them
const UPLOAD_MARKS = ['uploadid', 'error']

function dropUploadMarks(body: HTMLElement) {
  const media = [...body.querySelectorAll('img, video')]
  const names = UPLOAD_MARKS.filter((name) => media.some((element) => element.hasAttribute(name)))
  for (const element of media) {
    for (const name of names) {
      element.removeAttribute(name)
    }
  }

  return names
}

// Old Drive's mention wrote whom it named, a user or a group, over its data-type, which the editor
// reads as mention (b5aa37a1 MentionExtension.ts:199-208, Document.vue:205/211)
const DRIVE_MENTION_TYPES = ['User', 'User Group']

function readOldMentions(body: HTMLElement) {
  const mentions = [...body.querySelectorAll('span.mention[data-type][data-id]')].filter(
    (element) => DRIVE_MENTION_TYPES.includes(element.getAttribute('data-type')!),
  )
  for (const mention of mentions) {
    mention.setAttribute('data-type', 'mention')
  }

  if (!mentions.length) {
    return []
  }

  return ['type']
}

// Drive's mention held its author, which it never drew; its words stay
function dropMentionAuthors(body: HTMLElement) {
  const mentions = [...body.querySelectorAll('[data-author]')].filter(
    (element) => atomNameOf(element) === 'mention',
  )
  for (const mention of mentions) {
    mention.removeAttribute('data-author')
  }

  if (!mentions.length) {
    return []
  }

  return ['author']
}

// The class sets old Drive's editor wrote on its nodes and never read back, each whole set by its
// commit and line in DocEditor/TextEditor.vue
const DRIVE_CLASSES: Record<string, string[]> = {
  // listItem 81496fa39:313, taskItem d495bcef8:342
  li: ['prose-list-item', 'my-task-item'],
  // paragraph 8b59604c7:450, 44ba54162^:450, d3dbf0f92:449
  p: ['legacy', 'not-prose', 'legacy-p'],
  // heading not-prose on levels 1 to 3 d081e381d:310 and 1 to 4 637c3281d:316, not-prose leading-7
  // on levels 1 to 4 802065431:351, legacy on levels 1 to 5 8b59604c7:456
  ...Object.fromEntries(
    ['h1', 'h2', 'h3', 'h4'].map((tag) => [tag, ['not-prose', 'not-prose leading-7', 'legacy']]),
  ),
  h5: ['legacy'],
  // bulletList d081e381d:327, orderedList d081e381d:334, taskList d495bcef8:337
  ul: ['not-prose'],
  ol: ['not-prose'],
  // blockquote f5936ffea:408
  blockquote: ['prose-quoteless text-black border-l-2 pl-2 border-gray-400 text-[0.9em]'],
  // codeBlock c52d39e28:393, f5936ffea:402
  pre: [
    'not-prose my-5 px-4 py-2 text-[0.9em] font-mono text-black bg-gray-50 rounded border border-gray-300 overflow-x-auto',
    'not-prose my-5 px-4 pt-4 pb-2 text-[0.9em] font-mono text-black bg-gray-50 rounded border border-gray-300 overflow-x-scroll',
  ],
  // code f5936ffea:414
  code: ['not-prose px-px font-mono bg-gray-50 text-[0.85em] rounded-sm border border-gray-300'],
  // annotation e88592e0:517
  span: ['cursor-pointer annotation'],
}

function isDriveClass(element: Element) {
  const tokens = [...element.classList].sort().join(' ')
  return (DRIVE_CLASSES[element.localName] ?? []).some(
    (classes) => classes.split(' ').sort().join(' ') === tokens,
  )
}

function dropDriveClasses(body: HTMLElement) {
  const elements = [...body.querySelectorAll('[class]')].filter(isDriveClass)
  for (const element of elements) {
    element.removeAttribute('class')
  }

  if (!elements.length) {
    return []
  }

  return ['class']
}

// The ids of the comment marks in HTML, read before the 2023 marks take their keys
function markedHtmlIds(body: HTMLElement) {
  const ids = [...body.querySelectorAll('[data-comment-id]')].map((element) =>
    element.getAttribute('data-comment-id')!,
  )
  return new Set(ids.filter((id) => id.trim()))
}

// Drive's 2023 comment marks in HTML, read as comments under their thread's key; null when one
// can't be read or also holds a thread id
function markHtmlThreads(body: HTMLElement) {
  const spans = [...body.querySelectorAll('span[data-comment]')]
  const texts = spans.map((span) => span.getAttribute('data-comment')!)
  const threads = readOldThreads(texts)
  if (!threads || spans.some((span) => span.hasAttribute('data-comment-id'))) {
    return null
  }

  for (const [index, span] of spans.entries()) {
    span.setAttribute('data-comment-id', threads.keyOf.get(texts[index])!)
    span.removeAttribute('data-comment')
  }

  return threads
}

// The pictures of the people who wrote Drive's 2023 comments, which the names stand for
function droppedImages(threads: ReturnType<typeof readOldThreads>): Dropped[] {
  if (!threads?.hasImages) {
    return []
  }

  return [{ kind: 'noise', name: 'userImage' }]
}

// The fresh body as the editor draws it
function drawn(fresh: XmlFragment) {
  const { content } = yXmlFragmentToProseMirrorRootNode(fresh, schema)
  return DOMSerializer.fromSchema(schema).serializeFragment(content)
}

// A noise attribute is dropped when a value the old HTML holds isn't drawn
function valuesOf(root: ParentNode, name: string) {
  return [...root.querySelectorAll(`[${name}]`)].map((element) => element.getAttribute(name))
}

function droppedNoise(source: ParentNode, result: ParentNode) {
  return NOISE_ATTRIBUTES.filter((name) => {
    const drawnValues = new Set(valuesOf(result, name))
    return valuesOf(source, name).some((value) => !drawnValues.has(value))
  })
}

// The check compares the old HTML, its old media mapped, its colours and fonts read and a
// float beside an alignment dropped (recorded), Drive's old mention type read (recorded),
// frappe-ui's upload marks, Drive's mention author and its class sets dropped (recorded) and
// Drive's defaults dropped, with the fresh body as the editor draws it; every property the raw
// style text names must survive the parse, bar the noise list, and the whitespace the parser
// folds isn't compared
function fromHtml(html: string) {
  const { body } = new DOMParser().parseFromString(html, 'text/html')
  const marked = markedHtmlIds(body)
  const threads = markHtmlThreads(body)
  const hasUnreadableThreads = !threads || !!body.querySelector(ANNOTATION_TAG)
  const isFontRead = dropUnclosedFonts(body)
  const mentionTypes = readOldMentions(body)
  const repairedSpans = repairHtmlCellSpans(body)
  // Before the defaults go, since dropping one rewrites the style text from the parse
  const raw = rawStyles(body)
  const floats = droppedHtmlFloats(body)
  const isRewritten =
    !!threads?.threads.length || isFontRead || mentionTypes.length > 0 || repairedSpans > 0
  const node = schema.nodeFromJSON(generateJSON(readableHtml(body, html, isRewritten), extensions))
  const uploadMarks = dropUploadMarks(body)
  const mentionAuthors = dropMentionAuthors(body)
  const driveClasses = dropDriveClasses(body)
  dropDriveHtmlDefaults(body)
  const source = domInventory(body, atomNameOf)
  return {
    node,
    dropped: [] as Dropped[],
    hasUnreadableThreads,
    threads: threads?.threads ?? [],
    marked,
    check: (fresh: XmlFragment): Dropped[] | null => {
      const result = drawn(fresh)
      if (!raw.isKept || unkept(source, domInventory(result, atomNameOf)).length) {
        return null
      }

      const names = [
        ...raw.noise,
        ...uploadMarks,
        ...mentionTypes,
        ...mentionAuthors,
        ...driveClasses,
        ...floats,
        ...droppedNoise(body, result),
      ]
      return [
        ...names.map((name): Dropped => ({ kind: 'noise', name })),
        ...droppedImages(threads),
        ...droppedSpans(repairedSpans),
      ]
    },
  }
}

// The HTML read in place of a Yjs body holding nothing; the Yjs document's threads still refuse it
// and its held-back changes are still recorded
function fromHtmlOverYjs(old: Doc, html: string) {
  const parsed = fromHtml(html)
  return {
    ...parsed,
    dropped: [{ kind: 'empty-yjs' } as const, ...pendingDrop(old)],
    hasUnreadableThreads: parsed.hasUnreadableThreads || unreadableThreads(old).length > 0,
  }
}

function isNotComment([key]: [string, unknown]) {
  return key !== 'comment'
}

// What a body holds apart from its old comment marks
function withoutComments({ characters, elements }: Inventory): Inventory {
  return {
    characters: characters.map((character) => ({
      ...character,
      entries: character.entries.filter(isNotComment),
    })),
    elements: elements.map((piece) => ({ ...piece, entries: piece.entries.filter(isNotComment) })),
  }
}

// Each old comment moves from its mark to an anchor; the body must then hold the same with no
// comment mark, and no comment mark may lose its thread
function moveComments(body: XmlFragment) {
  const { anchors, copies } = oldCommentAnchors(body, schema)
  const marked = withoutComments(inventory(body))
  const ids = dropCommentMarks(body, schema)
  const left = inventory(body)
  const isMoved =
    ids.every((id) => Object.hasOwn(anchors, id)) &&
    !unkept(marked, left).length &&
    !unkept(left, marked).length
  const dropped = copies.map(({ id, text }): Dropped => ({ kind: 'comment-copy', id, text }))
  return { isMoved, anchors, dropped }
}

// An HTML read whose listed comments are found by their words; a mark wins over its listing
function withWordAnchors(parsed: ReturnType<typeof fromHtml>, comments: ListedComment[]) {
  const listed = comments.filter(({ id }) => !parsed.marked.has(id))
  return {
    ...parsed,
    placeListed: (fresh: XmlFragment) => wordAnchors(fresh, schema, listed),
    from: 'html' as const,
  }
}

function read(choice: Exclude<LegacyRead, { case: 'unreadable-yjs' }>, comments: ListedComment[]) {
  if (choice.case === 'yjs') {
    // Before fromYjs rewrites the old body
    const listed = placeRanges(choice.old, comments)
    return { ...fromYjs(choice.old), ...listed, from: 'yjs' as const }
  }

  if (choice.case === 'empty-yjs') {
    return withWordAnchors(fromHtmlOverYjs(choice.old, choice.html), comments)
  }

  return withWordAnchors(fromHtml(choice.html), comments)
}

type ReadComments = Pick<ReturnType<typeof read>, 'threads' | 'marked' | 'placeListed'>

function droppedSpans(count: number): Dropped[] {
  if (!count) {
    return []
  }

  return [{ kind: 'table-span', count }]
}

function deletedComment(id: string): Dropped {
  return { kind: 'comment-deleted', id }
}

// Every old comment, marked or listed, is anchored or recorded once as deleted; a listed comment
// may not take a 2023 thread's key, and each 2023 thread must be anchored
function placeComments(body: XmlFragment, listed: ListedComment[], comments: ReadComments) {
  const { threads, marked, placeListed } = comments
  const moved = moveComments(body)
  const keys = new Set(threads.map(({ key }) => key))
  const isKeyed =
    [...keys].every((key) => Object.hasOwn(moved.anchors, key)) &&
    !listed.some(({ id }) => keys.has(id))
  const placed = moved.isMoved && isKeyed && placeListed(body)
  if (!placed) {
    return null
  }

  const deleted = [...marked].filter((id) => !Object.hasOwn(moved.anchors, id))
  const records = [...deleted, ...placed.deleted].map(deletedComment)
  const marks = Object.entries(moved.anchors).filter(([id]) => !keys.has(id))
  return {
    anchors: { ...Object.fromEntries(marks), ...placed.anchors },
    threads: threads.map((thread) => ({ ...thread, anchor: moved.anchors[thread.key] })),
    dropped: [...moved.dropped, ...records],
  }
}

// The converted node as a fresh collaborative body, its headings given ids
function freshBody(node: PMNode) {
  const fresh = new Doc()
  prosemirrorToYXmlFragment(withHeadingIds(node), fresh.getXmlFragment(BODY_FIELD))
  return fresh
}

function checkedBody(
  choice: Exclude<LegacyRead, { case: 'unreadable-yjs' }>,
  listed: ListedComment[],
) {
  const { node, dropped, hasUnreadableThreads, check, from, ...comments } = read(choice, listed)
  if (hasUnreadableThreads) {
    return null
  }

  const fresh = freshBody(node)
  const body = fresh.getXmlFragment(BODY_FIELD)
  const noise = check(body)
  if (!noise || breaksStyle(body)) {
    return null
  }

  const placed = placeComments(body, listed, comments)
  if (!placed) {
    return null
  }

  return { fresh, from, ...placed, dropped: [...dropped, ...noise, ...placed.dropped] }
}

// A tab opening the state must write nothing to it, show all of it and show each thread on its words
function opensAsTab(state: Uint8Array, anchors: string[]) {
  const doc = new Doc()
  applyUpdate(doc, state)
  const before = snapshot(doc)
  const editor = tabEditor(doc)
  try {
    // Stands in for the create-tick dispatch a real tab makes (Tabs onCreate)
    editor.view.dispatch(editor.state.tr)
    return (
      equalSnapshots(before, snapshot(doc)) &&
      ySyncPluginKey.getState(editor.state)?.binding?.isFrozen === false &&
      anchors.every((anchor) => placeThread(editor.state, anchor).kind === 'text')
    )
  } finally {
    editor.destroy()
  }
}

/** The old document as a fresh collaborative body, checked to hold the old text, formatting and parts apart from what it drops. */
export function convertLegacy(legacy: LegacyBody, maxState: number): Converted {
  let checked: ReturnType<typeof checkedBody>
  try {
    const choice = readLegacy(legacy)
    if (choice.case === 'unreadable-yjs') {
      return { kind: 'failed', reason: choice.case }
    }

    const listed = listedComments(legacy.ycomments)
    checked = listed && checkedBody(choice, listed)
  } catch {
    checked = null
  }

  if (!checked) {
    return { kind: 'failed', reason: 'check' }
  }

  const state = encodeStateAsUpdate(checked.fresh)
  if (state.byteLength > maxState) {
    return { kind: 'failed', reason: 'too_large' }
  }

  const { dropped, from, anchors, threads } = checked
  let isOpenedAsIs = false
  try {
    isOpenedAsIs = opensAsTab(state, [
      ...Object.values(anchors),
      ...threads.map(({ anchor }) => anchor),
    ])
  } catch {
    isOpenedAsIs = false
  }

  if (!isOpenedAsIs) {
    return { kind: 'failed', reason: 'check' }
  }

  const converted = new Doc()
  applyUpdate(converted, state)
  const { html } = writerRender(converted)
  return { kind: 'converted', state, html, dropped, from, anchors, threads }
}
