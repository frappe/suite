import { XmlElement, XmlFragment, XmlText, type XmlHook } from 'yjs'

// The binding's name for a copy of a mark that can overlap another of its kind
export const OVERLAP_SUFFIX = /--[a-zA-Z0-9+/=]{8}$/

// A stored attribute or mark under its own name, whichever copy of it holds it
type Entry = [string, unknown]

interface Insert {
  insert: unknown
  attributes?: Record<string, unknown>
}

/** One character of a body's text with the formatting Yjs holds on it. */
export interface Character {
  char: string
  entries: Entry[]
}

/** An element of a body, or an embed in its text, with the attributes Yjs holds on it. */
export interface Piece {
  name: string
  entries: Entry[]
}

/** What a body holds that a reader would miss, in order: its text and its elements. */
export interface Inventory {
  characters: Character[]
  elements: Piece[]
}

function entriesOf(attributes: Record<string, unknown> = {}): Entry[] {
  return Object.entries(attributes)
    .filter(([, value]) => value != null)
    .map(([key, value]) => [key.replace(OVERLAP_SUFFIX, ''), value])
}

function addText(text: XmlText, found: Inventory) {
  for (const { insert, attributes } of text.toDelta() as Insert[]) {
    const entries = entriesOf(attributes)
    if (typeof insert !== 'string') {
      found.elements.push({ name: '#embed', entries })
      continue
    }

    for (const char of insert) {
      found.characters.push({ char, entries })
    }
  }
}

function addType(
  type: XmlElement | XmlFragment | XmlText | XmlHook,
  skipped: ReadonlySet<unknown>,
  found: Inventory,
) {
  if (skipped.has(type)) {
    return
  }

  if (type instanceof XmlText) {
    addText(type, found)
    return
  }

  // A type no node is built from, which the build sets aside
  if (!(type instanceof XmlElement || type instanceof XmlFragment)) {
    return
  }

  if (type instanceof XmlElement) {
    found.elements.push({ name: type.nodeName, entries: entriesOf(type.getAttributes()) })
  }

  for (const child of type.toArray()) {
    addType(child, skipped, found)
  }
}

/** What `body` holds, leaving out the types in `skipped` and all they hold. */
export function inventory(body: XmlFragment, skipped: ReadonlySet<unknown> = new Set()) {
  const found: Inventory = { characters: [], elements: [] }
  addType(body, skipped, found)
  return found
}

// Tags that format the text in them rather than hold a part of their own
const FORMATTING_TAGS = new Set([
  'a',
  'b',
  'big',
  'cite',
  'code',
  'del',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'u',
])

// Tags the editor reads as its own marks, named by the tag it draws them with, which
// conversion-styles.test.ts checks against the editor
const DRAWN_AS = new Map([
  ['b', 'strong'],
  ['i', 'em'],
  ['del', 's'],
  ['strike', 's'],
])

// The editor snaps a colour to its palette, so a colour counts by being there
const COLOUR_PROPS = new Set(['color', 'background-color'])

/** Attributes the editor may drop, recorded when it does. */
export const NOISE_ATTRIBUTES = ['spellcheck', 'loading']

// Word's own style properties, which the parse reads past
const NOISE_STYLE = /^mso-/

// jsdom never reads border-image: it reads none as nothing and any other value as none
const UNREAD_PROPERTIES = new Set(['border-image'])

// A boolean attribute draws by being there, whatever its value
const BOOLEAN_ATTRIBUTES = new Map([
  ['video', 'controls'],
  ['input', 'checked'],
])

// Class and style are compared by their parts, and noise not at all
const UNCOMPARED_ATTRIBUTES = new Set(['class', 'style', ...NOISE_ATTRIBUTES])

// A font size relative to the size around it
const RELATIVE_SIZE = /\d(?:em|ex|ch|%)|^(?:smaller|larger)\b/i

// The properties a span can reset to what's around it, and the values that reset them
const RESETTABLE = ['font-size', 'font-family', 'line-height']
const RESET = /^(?:inherit|unset|revert)\b/i

type AtomName = (element: Element) => string | undefined

function withPriority(value: string, priority: string) {
  if (!priority) {
    return value
  }

  return `${value} !${priority}`
}

function styleOf(element: Element) {
  const { style } = element as HTMLElement
  const found: Record<string, unknown> = {}
  for (const property of style) {
    let value = style.getPropertyValue(property)
    if (property === 'font-family') {
      // Read as the editor's font family reads it, quotes dropped
      value = value.replace(/['"]+/g, '')
    }

    const priority = style.getPropertyPriority(property)
    if (!COLOUR_PROPS.has(property)) {
      found[property] = withPriority(value, priority)
    } else if (value !== 'inherit') {
      found[property] = priority || true
    }
  }

  return found
}

// The drawn HTML may add classes of its own
function classOf(element: Element) {
  return Object.fromEntries([...element.classList].map((token) => [token, true]))
}

function attributesOf(element: Element): Entry[] {
  const flag = BOOLEAN_ATTRIBUTES.get(element.localName)
  const entries = [...element.attributes]
    .filter(({ name }) => !UNCOMPARED_ATTRIBUTES.has(name) && name !== flag)
    .map(({ name, value }): Entry => [name, value])
  if (flag) {
    entries.push([flag, element.hasAttribute(flag)])
  }

  if (element.classList.length) {
    entries.push(['class', classOf(element)])
  }

  const style = styleOf(element)
  if (Object.keys(style).length) {
    entries.push(['style', style])
  }

  return entries
}

function withFormat(formats: Entry[], element: Element) {
  if (element.localName === 'span') {
    return withSpan(formats, element)
  }

  const name = DRAWN_AS.get(element.localName) ?? element.localName
  return [...formats, [name, Object.fromEntries(attributesOf(element))] as Entry]
}

// The editor draws a span's background as the highlight, a mark of its own, and nested spans as one
function withSpan(formats: Entry[], element: Element) {
  const { 'background-color': background, ...style } = styleOf(element)
  const span = Object.fromEntries(attributesOf(element).filter(([name]) => name !== 'style'))
  if (Object.keys(style).length) {
    span.style = style
  }

  const lit = withHighlight(formats, background)
  if (!Object.keys(span).length) {
    return lit
  }

  return withFolded(lit, span)
}

function withHighlight(formats: Entry[], background: unknown) {
  if (background === undefined) {
    return formats
  }

  return [...formats, ['mark', { style: { 'background-color': background } }] as Entry]
}

type Attributes = Record<string, unknown>

// Nested spans fold unless they name the same attribute, both set a colour, which counts by being
// there, the inner size is relative to the outer, or the inner resets an outer size, font or line
// height, which the editor would reset to the paragraph's
function isFoldable(outer: Attributes, inner: Attributes) {
  const outerStyle = (outer.style ?? {}) as Attributes
  const innerStyle = (inner.style ?? {}) as Attributes
  const isShared = Object.keys(inner).some((name) => name !== 'style' && name in outer)
  const isRecoloured = Object.keys(innerStyle).some(
    (name) => COLOUR_PROPS.has(name) && name in outerStyle,
  )
  const isRelative =
    'font-size' in outerStyle && RELATIVE_SIZE.test(String(innerStyle['font-size'] ?? ''))
  const isReset = RESETTABLE.some(
    (name) => name in outerStyle && RESET.test(String(innerStyle[name] ?? '')),
  )
  return !isShared && !isRecoloured && !isRelative && !isReset
}

// A span inside another folds into it, the inner span winning each style property
function withFolded(formats: Entry[], span: Attributes) {
  const at = formats.map(([name]) => name).lastIndexOf('span')
  const outer = formats[at]?.[1] as Attributes | undefined
  if (!outer || !isFoldable(outer, span)) {
    return [...formats, ['span', span] as Entry]
  }

  const folded = { ...outer, ...span }
  if (outer.style && span.style) {
    folded.style = { ...(outer.style as Attributes), ...(span.style as Attributes) }
  }

  const result = [...formats]
  result[at] = ['span', folded]
  return result
}

// The parser folds ASCII whitespace, so it isn't compared; a non-breaking space is kept
function addDomText(text: string, formats: Entry[], found: Inventory) {
  for (const char of text) {
    if (!/[ \t\n\r\f]/.test(char)) {
      found.characters.push({ char, entries: formats })
    }
  }
}

// An atom counts by its name, its attributes and the words it holds, such as a mention's label
function addElement(element: Element, formats: Entry[], atomName: AtomName, found: Inventory) {
  const name = atomName(element)
  let inner = formats
  if (name) {
    found.elements.push({ name, entries: attributesOf(element) })
  } else if (FORMATTING_TAGS.has(element.localName)) {
    inner = withFormat(formats, element)
  } else {
    found.elements.push({ name: element.localName, entries: attributesOf(element) })
  }

  for (const child of element.childNodes) {
    addDomNode(child, inner, atomName, found)
  }
}

function addDomNode(node: Node, formats: Entry[], atomName: AtomName, found: Inventory) {
  if (node.nodeType === Node.TEXT_NODE) {
    addDomText(node.textContent ?? '', formats, found)
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    addElement(node as Element, formats, atomName, found)
  }
}

/** What the HTML under `root` holds; `atomName` names the elements the editor reads as atoms. */
export function domInventory(root: ParentNode, atomName: AtomName) {
  const found: Inventory = { characters: [], elements: [] }
  for (const child of root.childNodes) {
    addDomNode(child, [], atomName, found)
  }

  return found
}

function propertyOf(piece: string) {
  const colon = piece.indexOf(':')
  if (colon < 0) {
    return null
  }

  return piece.slice(0, colon).trim().toLowerCase()
}

interface StylePiece {
  piece: string
  name: string | null
  value: string
  priority: string
  longhands: [string, string, string][]
}

// jsdom lists a shorthand beside its longhands without always keeping it in step, so only longhands count
function isLonghand(scratch: CSSStyleDeclaration, name: string, value: string) {
  scratch.cssText = ''
  scratch.setProperty(name, value)
  return scratch.length === 1
}

// A piece of raw style text parsed alone, since the whole text serialises a shorthand a later longhand
// overrides in part as ''
function parsedPiece(scratch: CSSStyleDeclaration, text: string): StylePiece {
  const piece = text.trim()
  const name = propertyOf(piece)
  if (!name) {
    return { piece, name, value: '', priority: '', longhands: [] }
  }

  scratch.cssText = piece
  const value = scratch.getPropertyValue(name)
  const priority = scratch.getPropertyPriority(name)
  const listed = [...scratch].map((property): [string, string, string] => [
    property,
    scratch.getPropertyValue(property),
    scratch.getPropertyPriority(property),
  ])
  const longhands = listed.filter(([property, held]) => isLonghand(scratch, property, held))
  return { piece, name, value, priority, longhands }
}

// A piece is lost when it names no property, names one jsdom can't read, or doesn't parse on its own
// with its !important
function isLost({ piece, name, value, priority }: StylePiece) {
  const isImportant = /!\s*important\s*$/i.test(piece)
  const isUnread = !name || !value || UNREAD_PROPERTIES.has(name)
  // A guard: jsdom never loses the priority of a piece that parses
  return !!piece && (isUnread || (isImportant && priority !== 'important'))
}

// Each longhand a piece lists is set in order with the priority its parse gave it, unless the rebuild
// already holds that longhand !important and this one isn't
function rebuiltStyle(element: HTMLElement, pieces: StylePiece[]) {
  const rebuilt = element.ownerDocument.createElement('div').style
  for (const [name, value, priority] of pieces.flatMap(({ longhands }) => longhands)) {
    if (priority || rebuilt.getPropertyPriority(name) !== 'important') {
      rebuilt.setProperty(name, value, priority)
    }
  }

  return rebuilt
}

// Whether the parse read the pieces as set in order; a longhand after its shorthand, or a ';' in quotes, breaks it
function isRebuilt(element: HTMLElement, scratch: CSSStyleDeclaration, pieces: StylePiece[]) {
  const { style } = element
  const rebuilt = rebuiltStyle(element, pieces)
  return [...new Set([...style, ...rebuilt])].every((name) => {
    const value = style.getPropertyValue(name)
    const isSame =
      value === rebuilt.getPropertyValue(name) &&
      style.getPropertyPriority(name) === rebuilt.getPropertyPriority(name)
    return isSame || !isLonghand(scratch, name, value || rebuilt.getPropertyValue(name))
  })
}

// The pieces of an element's raw style text the parse loses, and whether it read the rest in order
function checkedStyle(element: HTMLElement) {
  const scratch = element.ownerDocument.createElement('div').style
  const pieces = (element.getAttribute('style') ?? '')
    .split(';')
    .map((text) => parsedPiece(scratch, text))
  return {
    lost: pieces.filter(isLost).map(({ piece }) => piece),
    isRebuilt: isRebuilt(element, scratch, pieces),
  }
}

/** Whether the parse kept every property the raw style text under `root` names, and the noise properties it read past. */
export function rawStyles(root: ParentNode) {
  const checked = [...root.querySelectorAll<HTMLElement>('[style]')].map(checkedStyle)
  const lost = checked.flatMap((style) => style.lost)
  const noise = lost
    .map(propertyOf)
    .filter((name): name is string => name !== null && NOISE_STYLE.test(name))
  return {
    isKept: noise.length === lost.length && checked.every((style) => style.isRebuilt),
    noise: [...new Set(noise)],
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Whether `held` keeps all of `wanted`, defaults it gained aside; a list keeps its items in order
function holdsValue(held: unknown, wanted: unknown): boolean {
  if (Array.isArray(wanted)) {
    return JSON.stringify(held) === JSON.stringify(wanted)
  }

  if (isPlainObject(wanted)) {
    return (
      isPlainObject(held) &&
      Object.entries(wanted).every(([key, inner]) => inner == null || holdsValue(held[key], inner))
    )
  }

  return Object.is(held, wanted)
}

// Whether `held` keeps every entry of `wanted`, each in an entry of its own
function holdsEntries(held: Entry[], wanted: Entry[]) {
  const free = [...held]
  return wanted.every(([name, value]) => {
    const at = free.findIndex(([other, kept]) => other === name && holdsValue(kept, value))
    if (at < 0) {
      return false
    }

    free.splice(at, 1)
    return true
  })
}

function isSamePiece(held: Piece, wanted: Piece) {
  return held.name === wanted.name && holdsEntries(held.entries, wanted.entries)
}

// The first source element with no match in order in the result, which may hold more
function firstUnkeptPiece(source: Piece[], result: Piece[]) {
  let at = 0
  for (const piece of source) {
    while (at < result.length && !isSamePiece(result[at], piece)) {
      at += 1
    }

    if (at === result.length) {
      return piece
    }

    at += 1
  }

  return null
}

function firstChangedChar(source: Character[], result: Character[]) {
  const at = source.findIndex((character, index) => character.char !== result[index]?.char)
  if (at < 0 && source.length !== result.length) {
    return source.length
  }

  return at
}

/** What of `source` the `result` doesn't keep, first of each kind; empty when it keeps it all. */
export function unkept(source: Inventory, result: Inventory) {
  const missing: string[] = []
  const changedAt = firstChangedChar(source.characters, result.characters)
  if (changedAt >= 0) {
    missing.push(`text at ${changedAt}`)
  } else {
    const unformatted = source.characters.findIndex(
      (character, index) => !holdsEntries(result.characters[index].entries, character.entries),
    )
    if (unformatted >= 0) {
      missing.push(`formatting at ${unformatted}`)
    }
  }

  const piece = firstUnkeptPiece(source.elements, result.elements)
  if (piece) {
    missing.push(`element ${piece.name}`)
  }

  return missing
}
