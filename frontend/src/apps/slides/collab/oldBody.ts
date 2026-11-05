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
const ZERO_WIDTH_SPACE = '\u200b'
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
const FOLDED_WHITESPACE = /[ \t\n\r\f]/
const HARD_BREAK = 'hard break'
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
  parentTag: string
}

interface Run {
  node: Text | Element
  place: Place
}

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

function clampedOpacity(value: string) {
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
  return { ...place, block }
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
    } else if (isDrawnInLine(child, rules)) {
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
    parentTag: 'body',
  }
  drawChildren(root, place, rules, drawing)

  return drawing
}

function runLook({ styles, formats, opacity, block }: Place) {
  const seen = [...styles].filter(([name]) => name !== MARKER_OPACITY).sort()
  return JSON.stringify([seen, [...formats].sort(), exactOpacity(opacity), block])
}

function characters({ runs, items }: Drawing, rules: DrawRules) {
  const itemBlocks = new Set(items.map(({ place }) => place.block))
  const seen = new Set<number>()
  return runs.flatMap(({ node, place }) => {
    const look = runLook(place)
    if (node.nodeType !== Node.TEXT_NODE) {
      seen.add(place.block)
      return [[HARD_BREAK, look]]
    }

    let text = node.textContent ?? ''
    // A zero-width space at an item's start draws nothing, so its look is all it holds
    if (itemBlocks.has(place.block) && !seen.has(place.block)) {
      text = text.replace(/^\u200b+/, '')
      if (text) {
        seen.add(place.block)
      }
    }

    return [...text]
      .filter((char) => rules.isWhitespaceKept || !FOLDED_WHITESPACE.test(char))
      .map((char) => [char, look])
  })
}

function sameList(left: unknown[], right: unknown[]) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** How `saved` draws against `old`: `body` for everything but list markers, then the markers alone. */
export function compareBodies(old: Element, saved: Element, rules: DrawRules) {
  const [oldDrawing, savedDrawing] = [drawingOf(old, rules), drawingOf(saved, rules)]
  return {
    isSameBody:
      sameList(oldDrawing.blocks, savedDrawing.blocks) &&
      sameList(characters(oldDrawing, rules), characters(savedDrawing, rules)),
    isSameMarkers: sameList(oldDrawing.markers, savedDrawing.markers),
  }
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

function holdsItemLook(item: Place, first: Place, paragraph: Element) {
  return (
    markerStyles(paragraph.parentElement).every(
      (name) => first.styles.get(name) === item.styles.get(name),
    ) && exactOpacity(first.opacity) === markerOpacity(item)
  )
}

// The editor draws an item's bullet, indent and inherited look from its first text. When that text looks
// different, a leading zero-width space takes the item's look, as the editor's own new items do
export function holdItemLooks(root: Element, rules: DrawRules) {
  const { items, runs } = drawingOf(root, rules)
  for (const { paragraph, place } of items) {
    const first = runs.find((run) => run.place.block === place.block)
    const isTextFirst = first?.node.nodeType === Node.TEXT_NODE
    if (!first || !isTextFirst || first.node.textContent?.startsWith(ZERO_WIDTH_SPACE)) {
      continue
    }

    if (holdsItemLook(place, first.place, paragraph)) {
      continue
    }

    const look = ITEM_STYLES.filter((name) => place.styles.has(name)).map((name) => {
      const value = place.styles.get(name)
      return `${name}: ${value}`
    })
    const opacity = markerOpacity(place)
    if (opacity < 1) {
      look.push(`opacity: ${opacity}`)
    }

    const span = root.ownerDocument.createElement('span')
    span.setAttribute('style', look.join('; '))
    span.textContent = ZERO_WIDTH_SPACE
    paragraph.prepend(span)
  }
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
