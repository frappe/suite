// What an old text body draws: the old view shows its HTML with `v-html`, so a character looks as CSS
// inheritance and TextElement.vue's and TableElement.vue's rules say, not as its own marks say. The converter
// compares this for the old HTML and the HTML the saved body renders, so a formatting or whitespace change
// that the marks alone wouldn't show still fails

// Inherited, so each one reaches a character from any element above it
const INHERITED = [
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-align',
  'text-transform',
]
const FONT_WEIGHT = 'font-weight'
// What `.tableElement table th` gives a header cell
const HEADER_WEIGHT = '600'
const WEIGHT_KEYWORDS = new Map<string, string>([
  ['normal', '400'],
  ['bold', '700'],
])
// CSS's steps for `bolder` and `lighter`: below each bound, the weight drawn, where null keeps the one inherited
const RELATIVE_WEIGHTS = new Map<string, [below: number, weight: number | null][]>([
  [
    'bolder',
    [
      [350, 400],
      [550, 700],
      [900, 900],
      [Infinity, null],
    ],
  ],
  [
    'lighter',
    [
      [100, null],
      [550, 100],
      [750, 400],
      [Infinity, 700],
    ],
  ],
])
// The app's preflight gives a paragraph no margin, so a zero one draws nothing
const ZERO_MARGIN = /^margin(-(top|right|bottom|left))?: 0(px)?( 0(px)?)*$/
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
const CARRIED_STYLES = [...ITEM_STYLES, FONT_WEIGHT]
// Tags the editor reads as its own marks, by the tag it draws them with
const DRAWN_AS = new Map<string, string>([
  ['b', 'strong'],
  ['i', 'em'],
])
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
const WHITESPACE_BOX = 'whitespace box'
// `td` and `th` take text bare; a body or cell's bare text sits in one line, as a paragraph's does
const HOLDS_BARE_TEXT = new Set(['body', 'td', 'th'])
const LINE_HEIGHT_RULE = new Set(['p', 'li'])
// On an inherited property these take the value from above, as if nothing were stated
const INHERIT_KEYWORDS = new Set(['inherit', 'unset', 'revert', 'revert-layer'])
// What an attribute means when it's left out; the rest of an element's attributes draw nothing
const ATTRIBUTE_DEFAULTS = new Map<string, string | null>([
  ['colspan', '1'],
  ['colwidth', null],
  ['rowspan', '1'],
])

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

// `isBoxed`: a whitespace-only run whose own style or class can draw where its spaces fold away
type Character = [text: string, look: string, block: number, isBoxed?: boolean]

interface Drawing {
  blocks: string[]
  markers: string[]
  // Apart from `markers`: a look run holds any weight but bold, which saves as a mark and not a weight
  markerWeights: string[]
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
    } else if (ATTRIBUTE_DEFAULTS.has(name) && ATTRIBUTE_DEFAULTS.get(name) !== value) {
      entries.push([`${tag}@${name}`, value])
    }
  }

  return entries
}

function isFormatting(node: Node) {
  return !(node instanceof Element) || FORMATTING_TAGS.has(node.localName)
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

// The weight a character draws at, as a number where CSS gives one
function drawnWeight(value: string, inherited: string) {
  const steps = RELATIVE_WEIGHTS.get(value)
  if (!steps || Number.isNaN(Number(inherited))) {
    return WEIGHT_KEYWORDS.get(value) ?? value
  }

  const [, weight] = steps.find(([below]) => Number(inherited) < below)!
  return String(weight ?? inherited)
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

  // The app's preflight draws `strong` one step bolder
  if (tag === 'strong') {
    next.styles.set(FONT_WEIGHT, drawnWeight('bolder', place.styles.get(FONT_WEIGHT)!))
    next.fromItem.delete(FONT_WEIGHT)
  } else if (tag === 'th') {
    next.styles.set(FONT_WEIGHT, HEADER_WEIGHT)
    next.fromItem.delete(FONT_WEIGHT)
  }

  for (const [name, value] of styleEntries(element)) {
    if (tag === 'p' && ZERO_MARGIN.test(`${name}: ${value}`)) {
      continue
    }

    const isKeyword = isInherited(name) && INHERIT_KEYWORDS.has(value.toLowerCase())
    if (name === OPACITY) {
      next.opacity *= clampedOpacity(value)
      next.isFadedByItem ||= tag === 'li' && clampedOpacity(value) < 1
    } else if (isKeyword && place.styles.has(name)) {
      next.styles.set(name, place.styles.get(name)!)
    } else if (isKeyword) {
      next.styles.delete(name)
    } else if (name === FONT_WEIGHT) {
      next.styles.set(name, drawnWeight(value, place.styles.get(name)!))
      next.fromItem[tag === 'li' ? 'add' : 'delete'](name)
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

function isHeldWeight(weight: string) {
  return weight !== WEIGHT_KEYWORDS.get('bold')
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
    own.set('font', [place.styles.get('font-family'), place.styles.get(FONT_WEIGHT)].join(' '))
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
    drawing.markerWeights.push(next.styles.get(FONT_WEIGHT)!)
    drawing.items.push({ paragraph: element, place: next })
  }

  drawChildren(element, next, rules, drawing)
}

// Bold is the weight it draws, in the run's styles
function formatsOf(element: Element, drawn: string, own: Map<string, string>) {
  if (element.localName !== 'span' && drawn !== 'strong') {
    own.set(drawn, '')
  }

  for (const [name, value] of attributeEntries(element, drawn)) {
    own.set(name, value)
  }

  return own
}

function drawInline(node: Node, place: Place, rules: DrawRules, drawing: Drawing) {
  if (node instanceof Text) {
    drawing.runs.push({ node, place })
    return
  }

  if (!(node instanceof Element)) {
    return
  }

  const element = node
  const tag = element.localName
  if (STRIPPED_TAGS.has(tag)) {
    for (const child of element.childNodes) {
      drawNode(child, place, rules, drawing)
    }

    return
  }

  const drawn = DRAWN_AS.get(tag) ?? tag
  const own = new Map(place.formats)
  const next = entered(element, drawn, place, own)
  if (tag === 'br') {
    // The saved break holds its marks and no style or class of its own, so one that has them differs
    next.formats = formatsOf(element, 'span', own)
    drawing.runs.push({ node: element, place: next })
    return
  }

  next.formats = formatsOf(element, drawn, own)
  // An empty run draws nothing but what it holds, as padding or a box does
  if (!element.hasChildNodes() && isBoxed(next.formats)) {
    drawing.runs.push({ node: element.ownerDocument.createTextNode(''), place: next })
  }

  for (const child of element.childNodes) {
    drawNode(child, next, rules, drawing)
  }
}

function drawNode(node: Node, place: Place, rules: DrawRules, drawing: Drawing) {
  if (!(node instanceof Element) || isFormatting(node) || node.localName === 'br') {
    drawInline(node, place, rules, drawing)
  } else {
    drawBlock(node, place, rules, drawing)
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
    const isInline = !(child instanceof Element) || isFormatting(child) || child.localName === 'br'
    if (!isInline) {
      line = null
      if (child instanceof Element) drawBlock(child, place, rules, drawing)
    } else if (!HOLDS_BARE_TEXT.has(parent.localName)) {
      drawInline(child, place, rules, drawing)
    } else if (line || isDrawnInLine(child, rules)) {
      line ??= implicitLine(place, drawing)
      drawInline(child, line, rules, drawing)
    }
  }
}

function drawingOf(root: Element, rules: DrawRules): Drawing {
  const drawing: Drawing = { blocks: [], markers: [], markerWeights: [], runs: [], items: [] }
  const place: Place = {
    // The app's own line height, which the rule above only overrides on a line and an item, and weight
    styles: new Map([
      ['line-height', '1.5'],
      [FONT_WEIGHT, '400'],
    ]),
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

// Each part of a block between hard breaks, which folds its whitespace on its own
function lines(all: Character[]) {
  const split: Character[][] = []
  let previous: Character | null = null
  for (const character of all) {
    if (!previous || previous[2] !== character[2] || previous[0] === HARD_BREAK) {
      split.push([])
    }

    split.at(-1)!.push(character)
    previous = character
  }

  return split
}

// What a space that folds away still draws: its run's own box, if it holds one
function foldedAway([, look, block, isBoxedRun]: Character): Character[] {
  if (!isBoxedRun) {
    return []
  }

  return [[WHITESPACE_BOX, look, block]]
}

function isSpace([text]: Character) {
  return FOLDED_WHITESPACE.test(text)
}

// A browser folds a run of spaces to one, in the first one's look, and draws none at a line's ends
function foldedLine(line: Character[]) {
  return line.flatMap((character, at): Character[] => {
    if (!isSpace(character)) {
      return [character]
    }

    const before = line[at - 1]
    const after = line.slice(at).find((next) => !isSpace(next))
    if (before && !isSpace(before) && after && after[0] !== HARD_BREAK) {
      return [[' ', character[1], character[2]]]
    }

    return foldedAway(character)
  })
}

// What draws besides marks, which draw nothing where a space folds away
function isBoxed(formats: Map<string, string>) {
  return [...formats.keys()].some((name) => !FORMATTING_TAGS.has(name))
}

// `held` names the items whose first character is a look run the old body doesn't have
function characters({ runs, items }: Drawing, rules: DrawRules, held: Set<number>) {
  const all = runs.flatMap(({ node, place }): Character[] => {
    const look = runLook(place)
    if (node.nodeType !== Node.TEXT_NODE) {
      return [[HARD_BREAK, look, place.block]]
    }

    const text = node.textContent ?? ''
    const isBoxedRun = !text.trim() && isBoxed(place.formats)
    const drawn = [...text].map((char): Character => [char, look, place.block, isBoxedRun])
    if (!text && isBoxedRun) {
      drawn.push([WHITESPACE_BOX, look, place.block])
    }

    // An inline holding only a space sizes its line even when the space folds away, so the saved body must
    // keep it. A space is compared only where it's kept
    const isOwnLine = !text.trim() && lineFit(place.styles) !== place.lineFit
    if (!rules.isWhitespaceKept && isOwnLine) {
      drawn.unshift([OWN_LINE_HEIGHT, look, place.block])
    }

    return drawn
  })
  const added = new Set([...held].map((at) => items[at].place.block))
  const folded = lines(all).flatMap(foldedLine)
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
    isSameMarkers:
      sameList(oldDrawing.markers, savedDrawing.markers) &&
      sameList(oldDrawing.markerWeights, savedDrawing.markerWeights),
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
    const weight = oldDrawing.markerWeights[at]
    const isSameWeight = weight === savedDrawing.markerWeights[at] || !isHeldWeight(weight)
    const isSameItem =
      oldDrawing.markers[at] === savedDrawing.markers[at] &&
      isSameWeight &&
      (isSameBody || isSameSpacing)
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
  const carried = CARRIED_STYLES.flatMap((name) => {
    if (!fromItem.has(name)) return []
    const value = styles.get(name)
    return [`${name}: ${value}`]
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
  const look = ITEM_STYLES.flatMap((name) => {
    if (!place.styles.has(name)) return []
    const value = place.styles.get(name)
    return [`${name}: ${value}`]
  })
  const weight = place.styles.get(FONT_WEIGHT)!
  if (isHeldWeight(weight)) {
    look.push(`${FONT_WEIGHT}: ${weight}`)
  }

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
