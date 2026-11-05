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
const PERCENT = 100
// A value the browser rejects here does nothing, where an unknown property still counts
const READ_BY_THE_BROWSER = new Set([...INHERITED, OPACITY])
const ITEM_STYLES = ['color', 'font-family', 'font-size', 'letter-spacing']
// Tags the editor reads as its own marks, by the tag it draws them with
const DRAWN_AS: Record<string, string> = { b: 'strong', i: 'em', del: 's', strike: 's' }
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
const TABLE_MINIMUMS = new Set(['table', 'col'])
// What an attribute means when it's left out; the rest of an element's attributes draw nothing
const ATTRIBUTE_DEFAULTS: Record<string, string | null> = {
  colspan: '1',
  colwidth: null,
  href: null,
  rowspan: '1',
  start: '1',
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
}

// The value the browser reads, or the raw text when jsdom can't read it, so a property jsdom doesn't
// know still counts
function styleEntries(element: Element) {
  const scratch = element.ownerDocument.createElement('div').style
  const entries: [string, string][] = []
  for (const piece of (element.getAttribute('style') ?? '').split(';')) {
    const colon = piece.indexOf(':')
    const name = piece.slice(0, Math.max(colon, 0)).trim().toLowerCase()
    scratch.cssText = piece
    const read = scratch.getPropertyValue(name)
    if (name && (read || !READ_BY_THE_BROWSER.has(name))) {
      const value = read || piece.slice(colon + 1).trim()
      entries.push([name, value.replace(/['"]/g, '')])
    }
  }

  return entries
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
    if (name === OPACITY) {
      next.opacity *= clampedOpacity(value)
      next.isFadedByItem ||= tag === 'li' && clampedOpacity(value) < 1
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

// To the mark's whole percent
function roundedOpacity(opacity: number) {
  return Math.round(opacity * PERCENT) / PERCENT
}

function blockEntry(tag: string, styles: Map<string, string>, own: Map<string, string>) {
  const looks = [styles.get('font-size')]
  if (tag === 'p') {
    looks.push(styles.get('line-height'), styles.get('text-align'))
  }

  return JSON.stringify([tag, looks, [...own].sort()])
}

function markerEntry({ styles, opacity }: Place) {
  const markerOpacity = clampedOpacity(styles.get(MARKER_OPACITY) ?? '1')
  return JSON.stringify([
    styles.get('color'),
    styles.get('font-family'),
    styles.get('letter-spacing'),
    roundedOpacity(opacity * markerOpacity),
  ])
}

function isOrderedItem(element: Element, tag: string) {
  return tag === 'li' && element.parentElement?.localName === 'ol'
}

function blockAttributes(element: Element, tag: string, own: Map<string, string>, place: Place) {
  for (const [name, value] of attributeEntries(element, tag)) {
    own.set(name, value)
  }

  // The tiptap table states a minimum where the old HTML may not; only a stated width sets a column
  if (TABLE_MINIMUMS.has(tag)) {
    own.delete('min-width')
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
    drawing.markers.push(markerEntry(next))
  }

  drawChildren(element, next, rules, drawing)
}

function formatsOf(element: Element, drawn: string, own: Map<string, string>) {
  if (element.localName !== 'span') {
    own.set(drawn, '')
  }

  // A link's target and rel draw nothing, and the editor sets its own
  for (const [name, value] of attributeEntries(element, drawn)) {
    if (drawn !== 'a' || name === 'a@href') {
      own.set(name, value)
    }
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
  if (tag === 'br') {
    drawing.runs.push({ node: element, place })
    return
  }

  const drawn = DRAWN_AS[tag] ?? tag
  const own = new Map(place.formats)
  const next = entered(element, drawn, place, own)
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
  const drawing: Drawing = { blocks: [], markers: [], runs: [] }
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
  return JSON.stringify([seen, [...formats].sort(), roundedOpacity(opacity), block])
}

function characters({ runs }: Drawing, rules: DrawRules) {
  return runs.flatMap(({ node, place }) => {
    const look = runLook(place)
    if (node.nodeType !== Node.TEXT_NODE) {
      return [[HARD_BREAK, look]]
    }

    const text = node.textContent ?? ''
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
    const faded = roundedOpacity(opacity)
    carried.push(`opacity: ${faded}`)
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

// A line's height comes from the rule, which the editor's paragraphs would hide behind their own default,
// so each one states the height it drew at
export function stateLineHeights(root: Element, rules: DrawRules) {
  for (const paragraph of root.querySelectorAll<HTMLElement>('p')) {
    if (!new Map(styleEntries(paragraph)).has('line-height')) {
      paragraph.style.setProperty('line-height', rules.lineHeight)
    }
  }
}

function pixels(value: string | undefined) {
  const match = /^([0-9.]+)px$/.exec(value ?? '')
  return match && Number(match[1])
}

function statedWidth(table: Element, frameWidth: unknown) {
  const { width, 'min-width': minimum, ...rest } = Object.fromEntries(styleEntries(table))
  let stated = pixels(width)
  if (width === '100%' && typeof frameWidth === 'number') {
    stated = frameWidth
  }

  const isOverridden = minimum && (pixels(minimum) ?? Infinity) > (stated ?? 0)
  if (Object.keys(rest).length || !stated || isOverridden) {
    return null
  }

  return Math.round(stated)
}

function columnCount(rows: HTMLTableRowElement[]) {
  const cells = rows.flatMap((row) => [...row.cells])
  const counts = rows.map((row) => [...row.cells].reduce((all, cell) => all + cell.colSpan, 0))
  const isGrid =
    counts.length > 0 &&
    counts.every((count) => count === counts[0]) &&
    cells.every((cell) => cell.rowSpan === 1 && !cell.hasAttribute('colwidth'))

  return isGrid && counts[0]
}

function columnWidths(table: HTMLTableElement, count: number, total: number) {
  const cols = [...table.querySelectorAll('col')]
  if (!cols.length) {
    // A fixed table with no widths shares its width equally, and a cell's width is whole pixels
    const share = Math.floor(total / count)
    const wider = total - share * count
    return Array.from({ length: count }, (_, at) => share + Number(at < wider))
  }

  const stated = cols.map((col) => pixels(new Map(styleEntries(col)).get('width')))
  const sum = stated.reduce<number>((all, width) => all + (width ?? NaN), 0)
  const isExact = stated.length === count && sum === total && stated.every(Number.isInteger)
  if (!isExact) {
    return null
  }

  return stated as number[]
}

function setColumnWidths(table: HTMLTableElement, widths: number[], total: number) {
  for (const row of table.rows) {
    let at = 0
    for (const cell of row.cells) {
      cell.setAttribute('colwidth', widths.slice(at, at + cell.colSpan).join(','))
      at += cell.colSpan
    }
  }

  table.querySelector('colgroup')?.remove()
  const colgroup = table.ownerDocument.createElement('colgroup')
  for (const width of widths) {
    colgroup.append(table.ownerDocument.createElement('col'))
    ;(colgroup.lastElementChild as HTMLElement).style.setProperty('width', `${width}px`)
  }

  table.prepend(colgroup)
  table.setAttribute('style', `width: ${total}px`)
}

// The editor reads a table's widths from its cells. A table laid out at a stated width, with no cell
// widths, can say the same thing on its cells. One with no stated width lays itself out from its text,
// which only a browser can measure, so it stays as it is and the comparison refuses it
export function stateColumnWidths(root: Element, frameWidth: unknown) {
  for (const table of root.querySelectorAll('table')) {
    const total = statedWidth(table, frameWidth)
    const count = columnCount([...table.rows])
    const widths = total && count && columnWidths(table, count, total)
    if (total && widths) {
      setColumnWidths(table, widths, total)
    }
  }
}
