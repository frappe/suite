// What an old text body draws: the old view shows its HTML with `v-html`, so a character looks as CSS
// inheritance and TextElement.vue's and TableElement.vue's rules say, not as its own marks say. The converter
// compares this for the old HTML and the HTML the saved body renders, so a formatting or whitespace change
// that the marks alone wouldn't show still fails

// Inherited, so each one reaches a character from any element above it
const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
]
const MARKER_OPACITY = '--marker-opacity'
const OPACITY = 'opacity'
// Removes the floats' own noise from a product of opacities and nothing a browser could draw
const OPACITY_DIGITS = 12
const PERCENT = 100
const ZERO_WIDTH_SPACE = '\u200b'
// What a zero-width space before it would change: combining marks, variation selectors and joiners join
// what comes before them, and a conjoining vowel or emoji modifier does too. A zero-width space itself doesn't
const JOINS_WHAT_IS_BEFORE = /^(?!\u200b)[\p{M}\p{Cf}\p{Emoji_Modifier}\u1160-\u11ff\ud7b0-\ud7ff]/u
// A value the browser rejects here does nothing, where an unknown property still counts
const READ_BY_THE_BROWSER = new Set([...INHERITED, OPACITY])
const ITEM_STYLES = ['color', 'font-family', 'font-size', 'letter-spacing']
// Tags the editor reads as its own marks, by the tag it draws them with
const DRAWN_AS: Record<string, string> = { b: 'strong', i: 'em' }
// The old view's sanitizer takes these off and keeps what's inside, so they draw nothing
const STRIPPED_TAGS = new Set(['a', 'code', 'del', 'strike'])
const FORMATTING_TAGS = new Set([
  'a',
  'b',
  'code',
  'del',
  'em',
  'i',
  's',
  'span',
  'strike',
  'strong',
  'u',
])
const FOLDED_WHITESPACE = /^[ \t\n\r\f]$/
const HARD_BREAK = 'hard break'
const OWN_LINE_HEIGHT = 'own line height'
// `td` and `th` take text bare; a body or cell's bare text sits in one line, as a paragraph's does
const HOLDS_BARE_TEXT = new Set(['body', 'td', 'th'])
const LINE_HEIGHT_RULE = new Set(['p', 'li'])
// On an inherited property these take the value from above, as if nothing were stated
const INHERIT_KEYWORDS = new Set(['inherit', 'unset', 'revert', 'revert-layer'])
// What an attribute means when it's left out; the rest of an element's attributes draw nothing
const ATTRIBUTE_DEFAULTS: Record<string, string | null> = {
  colspan: '1',
  colwidth: null,
  rowspan: '1',
}

export interface DrawRules {
  // What `.textElement p, .textElement li` or `.tableElement p` give a line
  lineHeight: string
  // `white-space: pre` or `pre-wrap` in a text box, the browser's folding in a table
  isWhitespaceKept: boolean
}

interface Place {
  styles: Map<string, string>
  formats: Map<string, string>
  opacity: number
  // Which of `styles` came from a list item, and whether its opacity did
  fromItem: Set<string>
  isFadedByItem: boolean
  block: number
  // What sets the height of the line this sits on
  lineFit: string
  parentTag: string
}

interface Run {
  node: Text | Element
  place: Place
}

type Character = [text: string, look: string, block: number]

interface Drawing {
  blocks: string[]
  markers: string[]
  runs: Run[]
  items: { paragraph: Element; place: Place }[]
}

// The value the browser reads, or the raw text when jsdom can't read it, so a property jsdom doesn't
// know still counts. An `!important` declaration beats a later plain one
function styleEntries(element: Element) {
  const scratch = element.ownerDocument.createElement('div').style
  const entries = new Map<string, string>()
  const important = new Set<string>()
  for (const piece of (element.getAttribute('style') ?? '').split(';')) {
    const colon = piece.indexOf(':')
    const name = piece.slice(0, Math.max(colon, 0)).trim().toLowerCase()
    scratch.cssText = piece
    const read = scratch.getPropertyValue(name)
    const isImportant = !!scratch.getPropertyPriority(name)
    if (
      !name ||
      (!read && READ_BY_THE_BROWSER.has(name)) ||
      (!isImportant && important.has(name))
    ) {
      continue
    }

    const value = read || piece.slice(colon + 1).trim()
    entries.set(name, value.replace(/['"]/g, ''))
    if (isImportant) {
      important.add(name)
    }
  }

  return [...entries]
}

function attributeEntries(element: Element, tag: string) {
  const entries: [string, string][] = []
  for (const { name, value } of element.attributes) {
    if (name === 'class') {
      entries.push(
        ...[...element.classList].map((token): [string, string] => [`class ${token}`, '']),
      )
    } else if (name in ATTRIBUTE_DEFAULTS && ATTRIBUTE_DEFAULTS[name] !== value) {
      entries.push([`${tag}@${name}`, value])
    }
  }

  return entries
}

function isFormatting(node: Node) {
  return node.nodeType !== Node.ELEMENT_NODE || FORMATTING_TAGS.has((node as Element).localName)
}

function isInherited(name: string) {
  return INHERITED.includes(name) || name === MARKER_OPACITY
}

// An empty value isn't 0, and reads like any other that isn't a number
function clampedOpacity(value: string) {
  if (!value) {
    return NaN
  }

  return Math.min(1, Math.max(0, Number(value)))
}

// `own` holds what isn't inherited: for a mark, what it adds to its text
function entered(element: Element, tag: string, place: Place, own: Map<string, string>): Place {
  const next: Place = {
    ...place,
    styles: new Map(place.styles),
    fromItem: new Set(place.fromItem),
  }
  if (LINE_HEIGHT_RULE.has(tag)) {
    next.styles.delete('line-height')
  }

  for (const [name, value] of styleEntries(element)) {
    const isKeyword = isInherited(name) && INHERIT_KEYWORDS.has(value.toLowerCase())
    if (name === OPACITY) {
      next.opacity *= clampedOpacity(value)
      next.isFadedByItem ||= tag === 'li' && clampedOpacity(value) < 1
    } else if (isKeyword && place.styles.has(name)) {
      next.styles.set(name, place.styles.get(name)!)
    } else if (isKeyword) {
      next.styles.delete(name)
    } else if (isInherited(name)) {
      next.styles.set(name, value)
      next.fromItem[tag === 'li' ? 'add' : 'delete'](name)
    } else if (name === 'font-style' && value === 'italic') {
      own.set('em', '')
    } else {
      own.set(name, value)
    }
  }

  return next
}

function exactOpacity(opacity: number) {
  return Number(opacity.toFixed(OPACITY_DIGITS))
}

function blockEntry(tag: string, styles: Map<string, string>, own: Map<string, string>) {
  const looks = [styles.get('font-size')]
  if (tag === 'p') {
    looks.push(styles.get('line-height'), styles.get('text-align'))
  }

  return JSON.stringify([tag, looks, [...own].sort()])
}

function markerOpacity({ styles, opacity }: Place) {
  return exactOpacity(opacity * clampedOpacity(styles.get(MARKER_OPACITY) ?? '1'))
}

function lineFit(styles: Map<string, string>) {
  return JSON.stringify(['font-size', 'font-family', 'line-height'].map((name) => styles.get(name)))
}

function isOrderedItem(element: Element, tag: string) {
  return tag === 'li' && element.parentElement?.localName === 'ol'
}

// A bullet sits at the left of a fixed-width box, so its letter spacing moves no pixel; an ordered
// item's number sits at the right of its box, so its spacing does
function markerStyles(item: Element | null) {
  if (item?.parentElement?.localName === 'ol') {
    return ITEM_STYLES
  }

  return ITEM_STYLES.filter((name) => name !== 'letter-spacing')
}

function markerEntry(place: Place, item: Element | null) {
  const looks = markerStyles(item).map((name) => place.styles.get(name))
  return JSON.stringify([...looks, markerOpacity(place)])
}

function blockAttributes(element: Element, tag: string, own: Map<string, string>, place: Place) {
  for (const [name, value] of attributeEntries(element, tag)) {
    own.set(name, value)
  }

  // An ordered item's marker column is measured in `ch` of its own font, so its font reaches its text
  if (isOrderedItem(element, tag)) {
    own.set('font', place.styles.get('font-family') ?? '')
  }
}

function drawBlock(element: Element, place: Place, rules: DrawRules, drawing: Drawing) {
  const tag = element.localName
  const own = new Map<string, string>()
  const next = entered(element, tag, place, own)
  if (LINE_HEIGHT_RULE.has(tag) && !next.styles.has('line-height')) {
    next.styles.set('line-height', rules.lineHeight)
  }

  blockAttributes(element, tag, own, next)
  next.parentTag = tag
  if (tag === 'colgroup' || (tag === 'col' && !own.size)) {
    drawChildren(element, next, rules, drawing)
    return
  }

  next.block = drawing.blocks.push(blockEntry(tag, next.styles, own)) - 1
  next.lineFit = lineFit(next.styles)
  if (tag === 'p' && place.parentTag === 'li' && !element.previousElementSibling) {
    drawing.markers.push(markerEntry(next, element.parentElement))
    drawing.items.push({ paragraph: element, place: next })
  }

  drawChildren(element, next, rules, drawing)
}

function formatsOf(element: Element, drawn: string, own: Map<string, string>) {
  if (element.localName !== 'span') {
    own.set(drawn, '')
  }

  for (const [name, value] of attributeEntries(element, drawn)) {
    own.set(name, value)
  }

  return own
}

function drawInline(node: Node, place: Place, rules: DrawRules, drawing: Drawing) {
  if (node.nodeType === Node.TEXT_NODE) {
    drawing.runs.push({ node: node as Text, place })
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return
  }

  const element = node as Element
  const tag = element.localName
  if (STRIPPED_TAGS.has(tag)) {
    for (const child of element.childNodes) {
      drawNode(child, place, rules, drawing)
    }

    return
  }

  const drawn = DRAWN_AS[tag] ?? tag
  const own = new Map(place.formats)
  const next = entered(element, drawn, place, own)
  if (tag === 'br') {
    // The saved break holds its marks and no style or class of its own, so one that has them differs
    next.formats = formatsOf(element, 'span', own)
    drawing.runs.push({ node: element, place: next })
    return
  }

  next.formats = formatsOf(element, drawn, own)
  for (const child of element.childNodes) {
    drawNode(child, next, rules, drawing)
  }
}

function drawNode(node: Node, place: Place, rules: DrawRules, drawing: Drawing) {
  if (isFormatting(node) || (node as Element).localName === 'br') {
    drawInline(node, place, rules, drawing)
  } else {
    drawBlock(node as Element, place, rules, drawing)
  }
}

function isDrawnInLine(node: Node, rules: DrawRules) {
  if (node.nodeType === Node.TEXT_NODE && !rules.isWhitespaceKept) {
    return !!node.textContent?.trim()
  }

  return node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE
}

function implicitLine(place: Place, drawing: Drawing) {
  const block = drawing.blocks.push(blockEntry('p', place.styles, new Map())) - 1
  return { ...place, block, lineFit: lineFit(place.styles) }
}

function drawChildren(parent: Element, place: Place, rules: DrawRules, drawing: Drawing) {
  let line: Place | null = null
  for (const child of parent.childNodes) {
    const isInline = isFormatting(child) || (child as Element).localName === 'br'
    if (!isInline) {
      line = null
      drawBlock(child as Element, place, rules, drawing)
    } else if (!HOLDS_BARE_TEXT.has(parent.localName)) {
      drawInline(child, place, rules, drawing)
    } else if (line || isDrawnInLine(child, rules)) {
      line ??= implicitLine(place, drawing)
      drawInline(child, line, rules, drawing)
    }
  }
}

function drawingOf(root: Element, rules: DrawRules): Drawing {
  const drawing: Drawing = { blocks: [], markers: [], runs: [], items: [] }
  const place: Place = {
    // The app's own line height, which the rule above only overrides on a line and an item
    styles: new Map([['line-height', '1.5']]),
    formats: new Map(),
    opacity: 1,
    fromItem: new Set(),
    isFadedByItem: false,
    block: -1,
    lineFit: '',
    parentTag: 'body',
  }
  drawChildren(root, place, rules, drawing)

  return drawing
}

function runLook({ styles, formats, opacity, block }: Place) {
  const seen = [...styles].filter(([name]) => name !== MARKER_OPACITY).sort()
  return JSON.stringify([seen, [...formats].sort(), exactOpacity(opacity), block])
}

// A browser folds a run of spaces to one, in the first one's look, and draws none at a line's ends
function foldedWhitespace(all: Character[]) {
  const drawn: Character[] = []
  let line = -1
  let space: Character | null = null
  let isLineStart = true
  for (const character of all) {
    const [text, look, block] = character
    if (block !== line) {
      line = block
      space = null
      isLineStart = true
    }

    if (FOLDED_WHITESPACE.test(text)) {
      space ??= [' ', look, block]
      continue
    }

    if (space && !isLineStart && text !== HARD_BREAK) {
      drawn.push(space)
    }

    drawn.push(character)
    space = null
    isLineStart = text === HARD_BREAK
  }

  return drawn
}

// `held` names the items whose first character is a look run the old body doesn't have
function characters({ runs, items }: Drawing, rules: DrawRules, held: Set<number>) {
  const all = runs.flatMap(({ node, place }): Character[] => {
    const look = runLook(place)
    if (node.nodeType !== Node.TEXT_NODE) {
      return [[HARD_BREAK, look, place.block]]
    }

    const text = node.textContent ?? ''
    const drawn = [...text].map((char): Character => [char, look, place.block])
    // An inline holding only a space sizes its line even when the space folds away, so the saved body must
    // keep it. A space is compared only where it's kept
    const isOwnLine = !text.trim() && lineFit(place.styles) !== place.lineFit
    if (!rules.isWhitespaceKept && isOwnLine) {
      drawn.unshift([OWN_LINE_HEIGHT, look, place.block])
    }

    return drawn
  })
  const added = new Set([...held].map((at) => items[at].place.block))
  const folded = foldedWhitespace(all)
  const drawn = rules.isWhitespaceKept ? all : folded
  return drawn.filter(([, , block]) => !added.delete(block))
}

function sameList(left: unknown[], right: unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** How `saved`, with look runs on `held` items, draws against `old`: `body` for everything but list markers, then the markers alone. */
export function compareBodies(old: Element, saved: Element, rules: DrawRules, held: Set<number>) {
  const [oldDrawing, savedDrawing] = [drawingOf(old, rules), drawingOf(saved, rules)]
  return {
    isSameBody:
      sameList(oldDrawing.blocks, savedDrawing.blocks) &&
      sameList(characters(oldDrawing, rules, new Set()), characters(savedDrawing, rules, held)),
    isSameMarkers: sameList(oldDrawing.markers, savedDrawing.markers),
  }
}

/** The items of `old`, past those already `held`, that `saved` draws differently without a look run. */
export function itemsToHold(old: Element, saved: Element, rules: DrawRules, held: Set<number>) {
  const [oldDrawing, savedDrawing] = [drawingOf(old, rules), drawingOf(saved, rules)]
  const needed = new Set<number>()
  if (oldDrawing.items.length !== savedDrawing.items.length) {
    return needed
  }

  const isSameBody = compareBodies(old, saved, rules, held).isSameBody
  for (const [at, { place }] of oldDrawing.items.entries()) {
    // A bullet shows no letter spacing, but what's after its first text inherits it from the item
    const savedPlace = savedDrawing.items[at].place
    const isSameSpacing =
      place.styles.get('letter-spacing') === savedPlace.styles.get('letter-spacing')
    const isSameItem =
      oldDrawing.markers[at] === savedDrawing.markers[at] && (isSameBody || isSameSpacing)
    if (!isSameItem && !held.has(at)) {
      needed.add(at)
    }
  }

  return needed
}

// In the old view a list item's style reached its text and breaks by CSS inheritance. The editor's items
// hold no style and draw one from their first text, so each run takes what it inherited, on a span of its
// own so it wins. This changes no words
function carriedStyle({ styles, fromItem, isFadedByItem, opacity }: Place) {
  const carried = ITEM_STYLES.filter((name) => fromItem.has(name)).map((name) => {
    const value = styles.get(name)
    return `${name}: ${value}`
  })
  if (isFadedByItem) {
    const exact = exactOpacity(opacity)
    carried.push(`opacity: ${exact}`)
  }

  return carried.join('; ')
}

export function carryItemStyles(root: Element, rules: DrawRules) {
  for (const { node, place } of drawingOf(root, rules).runs) {
    const style = carriedStyle(place)
    if (style) {
      const span = root.ownerDocument.createElement('span')
      span.setAttribute('style', style)
      node.replaceWith(span)
      span.append(node)
    }
  }
}

function isWholePercent(opacity: number) {
  return Number.isInteger(exactOpacity(opacity * PERCENT))
}

function prependLookRun(paragraph: Element, place: Place) {
  const look = ITEM_STYLES.filter((name) => place.styles.has(name)).map((name) => {
    const value = place.styles.get(name)
    return `${name}: ${value}`
  })
  const opacity = markerOpacity(place)
  if (opacity < 1) {
    look.push(`opacity: ${opacity}`)
  }

  const span = paragraph.ownerDocument.createElement('span')
  span.setAttribute('style', look.join('; '))
  span.textContent = ZERO_WIDTH_SPACE
  paragraph.prepend(span)
}

// The editor draws an item's bullet, indent and inherited look from its first text. Where `needed` says that
// differs, a leading zero-width space takes the item's look, as the editor's own new items do. An item inside
// one held here waits for the next pass, since it inherits from that one. Throws on what no run can hold
export function holdItemLooks(root: Element, rules: DrawRules, needed: Set<number>) {
  const { items, runs } = drawingOf(root, rules)
  const held = new Set<number>()
  const heldItems: Element[] = []
  for (const [at, { paragraph, place }] of items.entries()) {
    if (!isWholePercent(markerOpacity(place))) {
      throw new Error('A saved mark holds a whole percent of opacity')
    }

    const first = runs.find((run) => run.place.block === place.block)
    const isInsideHeld = heldItems.some((item) => item.contains(paragraph))
    if (!needed.has(at) || first?.node.nodeType !== Node.TEXT_NODE || isInsideHeld) {
      continue
    }

    if (JOINS_WHAT_IS_BEFORE.test(first.node.textContent ?? '')) {
      throw new Error('A look run would change the first character')
    }

    prependLookRun(paragraph, place)
    held.add(at)
    heldItems.push(paragraph.parentElement!)
  }

  return held
}

/** Whether text beside a rule says the parser split a paragraph around it: the text's own line is new. */
export function isBesideBareText(rule: Element) {
  return [...rule.parentNode!.childNodes].some((node) => {
    const isText = node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim()
    return isText || (node.nodeType === Node.ELEMENT_NODE && isFormatting(node))
  })
}

// A line's height comes from the rule, which the editor's paragraphs would hide behind their own default,
// so each one states the height it drew at
export function stateLineHeights(root: Element, rules: DrawRules) {
  for (const paragraph of root.querySelectorAll<HTMLElement>('p')) {
    if (!new Map(styleEntries(paragraph)).has('line-height')) {
      paragraph.style.setProperty('line-height', rules.lineHeight)
    }
  }
}
