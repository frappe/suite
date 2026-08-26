import fileSaver from 'file-saver'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  TextWrappingType,
  TextWrappingSide,
  VerticalAlign,
} from 'docx'
import { pxToTwips, toDocxLine } from '@/apps/writer/utils/typography'

const CELL_PADDING = 240
const TABLE_SPACE_BEFORE = 200
const TABLE_SPACE_AFTER = 240
const IMG_SPACE_BEFORE = 240
const IMG_SPACE_AFTER = 240
const HYPERLINK_COLOR = '0563C1'
const CODE_FONT = 'Courier New'

// A4/Letter-safe 1in margins on all sides; usable content area in twips/px.
const PAGE_MARGIN_TWIPS = convertInchesToTwip(1)
const PAGE_WIDTH_TWIPS = convertInchesToTwip(8.5)
const CONTENT_WIDTH_TWIPS = PAGE_WIDTH_TWIPS - 2 * PAGE_MARGIN_TWIPS
const CONTENT_WIDTH_PX = Math.floor(CONTENT_WIDTH_TWIPS / 15) // 1px = 15 twips

// Mirrors the app's named-color palette (frappe-ui
// molecules/editor/extensions/shared/color-palette.ts) since the exporter
// parses detached HTML with no stylesheet, so CSS vars never resolve.
const COLOR_MAP = {
  'var(--prose-color-red)': 'DC2626',
  'var(--prose-color-orange)': 'EA580C',
  'var(--prose-color-yellow)': 'CA8A04',
  'var(--prose-color-green)': '16A34A',
  'var(--prose-color-teal)': '0D9488',
  'var(--prose-color-cyan)': '06B6D4',
  'var(--prose-color-blue)': '1579D0',
  'var(--prose-color-indigo)': '5F46C7',
  'var(--prose-color-purple)': '9333EA',
  'var(--prose-color-pink)': 'DB2777',
  'var(--prose-color-gray)': '6B7280',
  'var(--surface-gray-2)': 'F3F3F3',
  'var(--outline-gray-2)': 'E2E2E2',
  'var(--ink-gray-3)': 'C7C7C7',
}

// Table-cell / mark highlight fills (frappe-ui highlight palette, ~100 tint).
const HIGHLIGHT_COLOR_MAP = {
  'var(--prose-highlight-red)': 'FECACA',
  'var(--prose-highlight-orange)': 'FED7AA',
  'var(--prose-highlight-yellow)': 'FEF08A',
  'var(--prose-highlight-green)': 'BBF7D0',
  'var(--prose-highlight-teal)': '99F6E4',
  'var(--prose-highlight-cyan)': 'A5F3FC',
  'var(--prose-highlight-blue)': 'BFDBFE',
  'var(--prose-highlight-indigo)': 'DBD5FF',
  'var(--prose-highlight-purple)': 'E9D5FF',
  'var(--prose-highlight-pink)': 'FBCFE8',
  'var(--prose-highlight-gray)': 'E5E7EB',
}

const FONT_MAP = {
  'var(--font-caveat)': 'Caveat',
  'var(--font-comic-sans)': 'Comic Sans MS',
  'var(--font-comfortaa)': 'Comfortaa',
  'var(--font-eb-garamond)': 'EB Garamond',
  'var(--font-geist)': 'Geist',
  'var(--font-ibm-plex)': 'IBM Plex Sans',
  'var(--font-inter)': 'Inter',
  'var(--font-jetbrains)': 'JetBrains Mono',
  'var(--font-lora)': 'Lora',
  'var(--font-merriweather)': 'Merriweather',
  'var(--font-nunito)': 'Nunito',
  fantasy: 'Fantasy',
  caveat: 'Caveat',
  'comic-sans': 'Comic Sans MS',
  comfortaa: 'Comfortaa',
  'eb-garamond': 'EB Garamond',
  geist: 'Geist',
  'ibm-plex': 'IBM Plex Sans',
  inter: 'Inter',
  jetbrains: 'JetBrains Mono',
  lora: 'Lora',
  merriweather: 'Merriweather',
  nunito: 'Nunito',
}

const ALIGN_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const HEADING_SIZES = { h1: 40, h2: 36, h3: 32, h4: 28, h5: 26, h6: 24 }

// Block-level tags a generic wrapper (tab/div/section from pasted or future
// nodes) might contain; anything else is treated as an inline-only leaf.
const BLOCK_TAGS = new Set([
  'DIV', 'P', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'VIDEO', 'IFRAME',
])

export function cssColorToDocx(c) {
  if (!c) return
  const t = c.trim()
  if (COLOR_MAP[t]) return COLOR_MAP[t]

  const hex = t.replace(/^#/, '')
  if (/^[0-9a-f]{6}$/i.test(hex)) return hex.toUpperCase()
  if (/^[0-9a-f]{3}$/i.test(hex))
    return hex
      .split('')
      .map((ch) => ch + ch)
      .join('')
      .toUpperCase()
}

export function cssBackgroundToDocx(c) {
  if (!c) return
  const t = c.trim()
  if (HIGHLIGHT_COLOR_MAP[t]) return HIGHLIGHT_COLOR_MAP[t]
  return cssColorToDocx(t)
}

export function cssFontToDocx(f) {
  if (!f) return
  const t = f.trim()
  if (FONT_MAP[t]) return FONT_MAP[t]

  const first = t.split(',')[0].replace(/['"]/g, '').trim()
  return first || undefined
}

export function pxToDocxSize(px) {
  if (!px) return
  const n = parseFloat(px)
  if (!Number.isFinite(n)) return
  const pt = n / 1.333
  return Math.round(pt * 2)
}

export function cssFontWeightToBold(weight) {
  if (!weight) return false
  const w = typeof weight === 'string' ? parseInt(weight) : weight
  return w >= 600
}

export function resolveAlignment(el) {
  return ALIGN_MAP[(el?.style?.textAlign || '').toLowerCase()]
}

export function clampSpan(v) {
  const n = parseInt(v || '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function resolveHref(href) {
  if (!href) return null
  try {
    return new URL(href, window.location.origin).href
  } catch {
    return null
  }
}

async function dataFromUrl(url) {
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

/** Natural size from the img's width/height attrs, scaled down to fit maxWidthPx. */
export function fitImageSize(el, maxWidthPx) {
  let width = parseFloat(el.getAttribute('width') || '560')
  let height = parseFloat(el.getAttribute('height') || '315')
  if (!Number.isFinite(width) || width <= 0) width = 560
  if (!Number.isFinite(height) || height <= 0) height = 315
  if (width > maxWidthPx && maxWidthPx > 0) {
    const scale = maxWidthPx / width
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }
  return { width, height }
}

/**
 * Every inline (text-level) node the editor can emit, turned into docx
 * ParagraphChild instances. Handles nested marks (bold/italic/color/etc.),
 * links (wrapped as ExternalHyperlink), inline code, highlights, and inline
 * images — all of which can appear inside a run of text, not just as direct
 * block children.
 */
async function inlineToRuns(node, inherited = {}, ctx) {
  if (node.nodeType === Node.TEXT_NODE) {
    return [new TextRun({ ...inherited, text: node.nodeValue || '' })]
  }
  if (!(node instanceof HTMLElement)) return []

  const tag = node.tagName.toLowerCase()

  if (tag === 'img') {
    const src = node.getAttribute('src')
    if (!src) return []
    try {
      const bytes = await dataFromUrl(src)
      const { width, height } = fitImageSize(node, ctx.contentWidthPx)
      return [new ImageRun({ data: bytes, transformation: { width, height } })]
    } catch (e) {
      console.warn('Image fetch failed:', src, e)
      return []
    }
  }

  if (tag === 'a' && node.hasAttribute('data-attachment')) {
    const href = resolveHref(node.getAttribute('href'))
    const label = node.textContent?.trim() || 'Attachment'
    if (!href) return [new TextRun({ ...inherited, text: `[Attachment: ${label}]` })]
    return [
      new ExternalHyperlink({
        link: href,
        children: [
          new TextRun({
            ...inherited,
            text: `\u{1F4CE} ${label}`,
            color: inherited.color || HYPERLINK_COLOR,
            underline: inherited.underline || {},
          }),
        ],
      }),
    ]
  }

  if (tag === 'a' && node.hasAttribute('href')) {
    const href = resolveHref(node.getAttribute('href'))
    if (!href) return inlineToRunsChildren(node, inherited, ctx)

    const linkStyle = {
      ...inherited,
      color: inherited.color || HYPERLINK_COLOR,
      underline: inherited.underline || {},
    }
    const children = await inlineToRunsChildren(node, linkStyle, ctx)
    if (!children.length) children.push(new TextRun({ ...linkStyle, text: href }))
    return [new ExternalHyperlink({ link: href, children })]
  }

  const isU = tag === 'u' || (node.style.textDecoration || '').includes('underline')
  const isS = tag === 's' || (node.style.textDecoration || '').includes('line-through')
  const isCode = tag === 'code'
  const isMark = tag === 'mark'

  let fontFromInline
  if (node.style && node.style.fontFamily) {
    fontFromInline = cssFontToDocx(node.style.fontFamily)
  }

  let isBold = tag === 'strong' || inherited.bold
  if (node.style && node.style.fontWeight) {
    isBold = cssFontWeightToBold(node.style.fontWeight) || isBold
  }

  const highlightFill = isMark ? cssBackgroundToDocx(node.style.backgroundColor) : null

  const next = {
    ...inherited,
    bold: isBold,
    italics: tag === 'em' || inherited.italics,
    underline: isU ? {} : inherited.underline,
    strike: isS || inherited.strike,
    color: cssColorToDocx(node.style.color) || inherited.color,
    size: pxToDocxSize(node.style.fontSize) || inherited.size,
    font: fontFromInline || (isCode ? CODE_FONT : inherited.font),
    shading: highlightFill
      ? { fill: highlightFill }
      : isCode
        ? { fill: 'F1F1F1' }
        : inherited.shading,
  }

  return inlineToRunsChildren(node, next, ctx)
}

async function inlineToRunsChildren(node, style, ctx) {
  const runs = []
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeName === 'BR') {
      runs.push(new TextRun({ ...style, text: '', break: 1 }))
    } else {
      runs.push(...(await inlineToRuns(child, style, ctx)))
    }
  }
  return runs
}

// Mirror what the editor renders: spacing comes from the document settings, and
// a paragraph's own inline style wins over them.
export function paragraphSpacing(el, defaults) {
  const style = el?.style || {}
  return {
    before: style.marginTop ? pxToTwips(style.marginTop) : defaults.before,
    after: style.marginBottom ? pxToTwips(style.marginBottom) : defaults.after,
    line: style.lineHeight ? toDocxLine(style.lineHeight) : defaults.line,
    lineRule: 'auto',
  }
}

function emptyParagraph(ctx) {
  return new Paragraph({ children: [new TextRun({ text: '', font: ctx.defaultFont })] })
}

/**
 * A paragraph that consists of nothing but a single image gets the editor's
 * "block image" treatment (centered/aligned, or floated with text wrap);
 * anything else is built from inline runs (which may themselves contain
 * inline images, links, etc).
 */
async function paragraphFromP(p, ctx, baseStyle = {}) {
  const solo =
    p.childNodes.length === 1 &&
    p.firstChild.nodeType === Node.ELEMENT_NODE &&
    p.firstChild.tagName === 'IMG'
  if (solo) {
    const built = await imageParagraph(p.firstChild, ctx)
    if (built) return built
  }

  const inherited = { font: ctx.defaultFont, ...baseStyle }
  const runs = []
  for (const n of Array.from(p.childNodes)) {
    runs.push(...(await inlineToRuns(n, inherited, ctx)))
  }
  if (!runs.length) runs.push(new TextRun({ text: ' ', font: ctx.defaultFont }))

  return new Paragraph({
    alignment: resolveAlignment(p),
    spacing: paragraphSpacing(p, ctx.defaultSpacing),
    children: runs,
  })
}

async function headingFromHx(hx, ctx) {
  const tag = hx.tagName.toLowerCase()
  const size = pxToDocxSize(hx.style.fontSize) || HEADING_SIZES[tag] || 28
  const runs = await inlineToRunsChildren(hx, { bold: true, size, font: ctx.defaultFont }, ctx)

  return new Paragraph({
    alignment: resolveAlignment(hx),
    spacing: { before: 240, after: 120 },
    children: runs.length ? runs : [new TextRun({ text: '', bold: true, size, font: ctx.defaultFont })],
  })
}

const BULLET_CHARS = ['•', '◦', '▪', '‣']
const ORDERED_LEVELS = [
  { format: LevelFormat.DECIMAL, text: '%1.' },
  { format: LevelFormat.LOWER_LETTER, text: '%2.' },
  { format: LevelFormat.LOWER_ROMAN, text: '%3.' },
  { format: LevelFormat.DECIMAL, text: '%4.' },
]
const MAX_LIST_LEVEL = 3

export function buildListLevels(reference, kind, defaultFont) {
  const levels = []
  for (let level = 0; level <= MAX_LIST_LEVEL; level++) {
    const indent = { left: 720 * (level + 1), hanging: 360 }
    const style = { paragraph: { indent, spacing: { before: 0, after: 0 } }, run: { font: defaultFont, size: 28 } }
    if (kind === 'bullets') {
      levels.push({
        level,
        format: LevelFormat.BULLET,
        text: BULLET_CHARS[level % BULLET_CHARS.length],
        alignment: AlignmentType.LEFT,
        style,
      })
    } else {
      const spec = ORDERED_LEVELS[level % ORDERED_LEVELS.length]
      levels.push({ level, format: spec.format, text: spec.text, alignment: AlignmentType.LEFT, style })
    }
  }
  return { reference, levels }
}

/**
 * A fresh, collision-free numbering reference name — no shared counter
 * needed. `crypto.randomUUID()` requires a secure context (HTTPS) and is
 * `undefined` on plain HTTP, which self-hosted instances commonly run on;
 * `crypto.getRandomValues()` has no such restriction and is the fallback.
 */
function uniqueListRef(kind) {
  return `${kind}-${randomId()}`
}

export function randomId() {
  // `typeof crypto` (not `crypto?.x`) is required here: optional chaining
  // only guards a null/undefined *value*, not a wholly undeclared global —
  // referencing the bare `crypto` identifier still throws a ReferenceError
  // if it doesn't exist at all.
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
    if (typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/**
 * Each top-level <ul>/<ol> gets its own numbering reference (two separate
 * lists must not share a running counter), and nested <ul>/<ol> inside an
 * <li> recurse at the next indent level instead of collapsing into the
 * parent bullet's paragraph.
 *
 * Returns { paragraphs, numberingConfigs } rather than mutating ctx: the
 * numbering config for a list only exists where its <ul>/<ol> was found, so
 * it's returned alongside the paragraphs and merged by the caller instead of
 * being pushed into shared state mid-traversal.
 */
async function processListNode(el, ctx, level = 0) {
  const tag = el.tagName.toLowerCase()
  const isTask = tag === 'ul' && el.getAttribute('data-type') === 'taskList'

  let reference = null
  const numberingConfigs = []
  if (!isTask) {
    const kind = tag === 'ol' ? 'numbers' : 'bullets'
    reference = uniqueListRef(kind)
    numberingConfigs.push(buildListLevels(reference, kind, ctx.defaultFont))
  }

  const out = []
  for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
    const checked = (li.getAttribute('data-checked') || '').toLowerCase() === 'true'
    const runs = []
    const nestedLists = []

    for (const child of Array.from(li.childNodes)) {
      if (child.nodeName === 'P') {
        runs.push(...(await inlineToRunsChildren(child, { font: ctx.defaultFont }, ctx)))
      } else if (child.nodeName === 'UL' || child.nodeName === 'OL') {
        nestedLists.push(child)
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        runs.push(...(await inlineToRuns(child, { font: ctx.defaultFont }, ctx)))
      }
    }

    if (isTask) {
      const checkbox = checked ? '☑ ' : '☐ '
      out.push(
        new Paragraph({
          indent: { left: 720 * (level + 1) },
          spacing: ctx.defaultSpacing,
          children: [
            new TextRun({ text: checkbox, font: ctx.defaultFont, size: 28 }),
            ...(runs.length ? runs : [new TextRun({ text: '', font: ctx.defaultFont })]),
          ],
        }),
      )
    } else {
      out.push(
        new Paragraph({
          spacing: ctx.defaultSpacing,
          children: runs.length ? runs : [new TextRun({ text: '', font: ctx.defaultFont })],
          numbering: { reference, level },
        }),
      )
    }

    for (const nested of nestedLists) {
      const child = await processListNode(nested, ctx, Math.min(level + 1, MAX_LIST_LEVEL))
      out.push(...child.paragraphs)
      numberingConfigs.push(...child.numberingConfigs)
    }
  }
  return { paragraphs: out, numberingConfigs }
}

async function paragraphsFromBlockquote(el, ctx) {
  const paras = []
  let isFirst = true
  let lastChildren = null
  const openQuote = '“'
  const closeQuote = '”'
  const defaultFont = ctx.defaultFont

  const border = {
    left: { color: 'CCCCCC', size: 24, style: BorderStyle.SINGLE },
  }

  const collectP = async (n) => {
    if (n.nodeName === 'P') {
      const runs = await inlineToRunsChildren(n, { italics: true, font: defaultFont }, ctx)
      const children = isFirst
        ? [new TextRun({ text: openQuote, italics: true, font: defaultFont }), ...runs]
        : runs
      lastChildren = children.length
        ? children
        : [new TextRun({ text: ' ', italics: true, font: defaultFont })]

      paras.push(
        new Paragraph({
          border,
          indent: { left: 720 },
          spacing: { before: 240, after: 240 },
          children: lastChildren,
        }),
      )
      isFirst = false
    } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) {
      const text = isFirst ? openQuote + n.nodeValue : n.nodeValue
      lastChildren = [new TextRun({ text, italics: true, font: defaultFont })]

      paras.push(
        new Paragraph({
          border,
          indent: { left: 720 },
          spacing: { before: 240, after: 240 },
          children: lastChildren,
        }),
      )
      isFirst = false
    } else {
      for (const child of Array.from(n.childNodes || [])) await collectP(child)
    }
  }

  for (const child of Array.from(el.childNodes)) await collectP(child)

  if (paras.length > 0 && lastChildren) {
    lastChildren.push(new TextRun({ text: closeQuote, italics: true, font: defaultFont }))
  }

  if (!paras.length) {
    paras.push(
      new Paragraph({
        border,
        indent: { left: 720 },
        spacing: { before: 240, after: 240 },
        children: [
          new TextRun({ text: openQuote, italics: true, font: defaultFont }),
          new TextRun({ text: ' ', italics: true, font: defaultFont }),
          new TextRun({ text: closeQuote, italics: true, font: defaultFont }),
        ],
      }),
    )
  }

  return paras
}

/** <pre><code> content is one text blob with literal newlines — Word needs an explicit break per line. */
function paragraphFromCodeBlock(el, ctx) {
  const codeEl = el.querySelector(':scope > code') || el
  const lines = (codeEl.textContent || '').split('\n')
  const runStyle = { font: CODE_FONT, size: 20, color: 'D4D4D4' }

  const runs = []
  lines.forEach((line, i) => {
    if (i > 0) runs.push(new TextRun({ ...runStyle, text: '', break: 1 }))
    if (line.length) runs.push(new TextRun({ ...runStyle, text: line }))
  })

  return new Paragraph({
    spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER, line: 240, lineRule: 'auto' },
    shading: { fill: '1E1E1E' },
    indent: { left: 200, right: 200 },
    children: runs.length ? runs : [new TextRun({ ...runStyle, text: '' })],
  })
}

function dividerParagraph(ctx) {
  return new Paragraph({
    spacing: { before: 240, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR_MAP['var(--outline-gray-2)'] } },
    children: [new TextRun({ text: '', font: ctx.defaultFont })],
  })
}

function placeholderParagraph(label, ctx) {
  return new Paragraph({
    spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER },
    children: [new TextRun({ text: label, italics: true, color: '888888', font: ctx.defaultFont })],
  })
}

function blockForVideo(el, ctx) {
  const title = el.getAttribute('title') || el.getAttribute('src')
  const href = resolveHref(el.getAttribute('src'))
  if (!href) return placeholderParagraph('[Video]', ctx)
  return new Paragraph({
    spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER },
    children: [
      new ExternalHyperlink({
        link: href,
        children: [
          new TextRun({
            text: `\u{1F3AC} ${title || 'Video'}`,
            color: HYPERLINK_COLOR,
            underline: {},
            font: ctx.defaultFont,
          }),
        ],
      }),
    ],
  })
}

function blockForIframe(el, ctx) {
  const href = resolveHref(el.getAttribute('src'))
  const title = el.getAttribute('title') || el.getAttribute('src') || 'Embedded content'
  if (!href) return placeholderParagraph('[Embedded content]', ctx)
  return new Paragraph({
    spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER },
    children: [
      new ExternalHyperlink({
        link: href,
        children: [new TextRun({ text: title, color: HYPERLINK_COLOR, underline: {}, font: ctx.defaultFont })],
      }),
    ],
  })
}

/** Block-level (own-line) image: centered/aligned, or floated with text wrap. */
async function imageParagraph(el, ctx) {
  const src = el.getAttribute('src')
  if (!src) return null
  let bytes
  try {
    bytes = await dataFromUrl(src)
  } catch (e) {
    console.warn('Image fetch failed:', src, e)
    return null
  }

  const floatAttr = (
    el.getAttribute('data-float') ||
    el.getAttribute('datafloat') ||
    el.style.float ||
    ''
  ).toLowerCase()
  const isFloating = floatAttr === 'left' || floatAttr === 'right'
  const maxWidth = isFloating ? Math.floor(ctx.contentWidthPx * 0.45) : ctx.contentWidthPx
  const { width, height } = fitImageSize(el, maxWidth)

  if (isFloating) {
    return new Paragraph({
      spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER },
      children: [
        new ImageRun({
          data: bytes,
          transformation: { width, height },
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.MARGIN,
              align: floatAttr === 'left' ? HorizontalPositionAlign.LEFT : HorizontalPositionAlign.RIGHT,
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PARAGRAPH,
              align: VerticalPositionAlign.TOP,
            },
            wrap: {
              type: TextWrappingType.SQUARE,
              side: TextWrappingSide.BOTH_SIDES,
              margin: { top: CELL_PADDING, bottom: CELL_PADDING, left: CELL_PADDING, right: CELL_PADDING },
            },
          },
        }),
      ],
    })
  }

  const alignAttr = (el.getAttribute('data-align') || 'center').toLowerCase()
  const alignment =
    alignAttr === 'left' ? AlignmentType.LEFT : alignAttr === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER

  return new Paragraph({
    alignment,
    spacing: { before: IMG_SPACE_BEFORE, after: IMG_SPACE_AFTER },
    children: [new ImageRun({ data: bytes, transformation: { width, height } })],
  })
}

/** Multiple images grouped into a gallery: laid out as a borderless N-column grid. */
async function blocksForImageGroup(el, ctx) {
  const cols = Math.min(6, Math.max(1, parseInt(el.getAttribute('data-columns') || '2', 10) || 2))
  const imgs = Array.from(el.querySelectorAll(':scope > img'))
  if (!imgs.length) return []

  const cellDxa = Math.floor(ctx.tableWidthDxa / cols)
  const cellWidthPx = Math.max(40, Math.floor(cellDxa / 15) - Math.floor((CELL_PADDING * 2) / 15))
  const noBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  }

  const rows = []
  for (let i = 0; i < imgs.length; i += cols) {
    const rowImgs = imgs.slice(i, i + cols)
    const cells = []
    for (const img of rowImgs) {
      const src = img.getAttribute('src')
      let children = [emptyParagraph(ctx)]
      if (src) {
        try {
          const bytes = await dataFromUrl(src)
          const { width, height } = fitImageSize(img, cellWidthPx)
          children = [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new ImageRun({ data: bytes, transformation: { width, height } })],
            }),
          ]
        } catch (e) {
          console.warn('Image fetch failed:', src, e)
        }
      }
      cells.push(
        new TableCell({
          children,
          borders: noBorders,
          margins: { top: 80, bottom: 80, left: 80, right: 80 },
          width: { size: cellDxa, type: WidthType.DXA },
        }),
      )
    }
    while (cells.length < cols) {
      cells.push(
        new TableCell({ children: [emptyParagraph(ctx)], borders: noBorders, width: { size: cellDxa, type: WidthType.DXA } }),
      )
    }
    rows.push(new TableRow({ children: cells }))
  }

  return [
    new Paragraph({ spacing: { before: IMG_SPACE_BEFORE }, children: [] }),
    new Table({
      width: { size: ctx.tableWidthDxa, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: new Array(cols).fill(cellDxa),
      rows,
    }),
    new Paragraph({ spacing: { after: IMG_SPACE_AFTER }, children: [] }),
  ]
}

export function countCols(tr) {
  let c = 0
  tr.querySelectorAll(':scope > th, :scope > td').forEach((td) => {
    c += clampSpan(td.getAttribute('colspan'))
  })
  return c
}

/** Distributes column widths from the table's resized colwidth attrs when every column reports one, else splits evenly. */
export function computeColumnWidths(trs, totalCols, tableWidthDxa) {
  const widthsPx = new Array(totalCols).fill(null)
  trs.forEach((tr) => {
    let col = 0
    tr.querySelectorAll(':scope > th, :scope > td').forEach((cell) => {
      const cs = clampSpan(cell.getAttribute('colspan'))
      const cw = cell.getAttribute('colwidth')
      if (cw) {
        const parts = cw
          .split(',')
          .map((n) => parseInt(n, 10))
          .filter(Number.isFinite)
        for (let i = 0; i < cs; i++) {
          const px = parts[i] ?? parts[parts.length - 1]
          if (px && widthsPx[col + i] == null) widthsPx[col + i] = px
        }
      }
      col += cs
    })
  })

  if (widthsPx.every((w) => w != null)) {
    const totalPx = widthsPx.reduce((a, b) => a + b, 0)
    return widthsPx.map((px) => Math.max(1, Math.round((px / totalPx) * tableWidthDxa)))
  }
  const colWidth = Math.floor(tableWidthDxa / totalCols)
  return new Array(totalCols).fill(colWidth)
}

/**
 * docx's Table constructor auto-inserts the vertical-merge continuation
 * cells for any cell declaring rowSpan, so we only need to emit the cells
 * that are actually present in the source HTML (rowspan-covered cells are
 * already absent from later rows there too) with their real colSpan/rowSpan.
 *
 * Returns { table, numberingConfigs }: a <ul>/<ol> inside a cell needs its
 * numbering config threaded up to the document level the same way a
 * top-level list's does (see `processListNode`), so it isn't dropped just
 * because it's nested inside a cell rather than a block.
 */
async function tableFromTABLE(tbl, ctx) {
  const borderColor = COLOR_MAP['var(--outline-gray-2)']
  const headerFill = COLOR_MAP['var(--surface-gray-2)']
  const numberingConfigs = []

  const trs = Array.from(tbl.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr'))
  let totalCols = 0
  trs.forEach((tr) => (totalCols = Math.max(totalCols, countCols(tr))))
  if (!totalCols) totalCols = 1

  const columnWidths = computeColumnWidths(trs, totalCols, ctx.tableWidthDxa)
  const cellCtx = { ...ctx, contentWidthPx: Math.max(40, Math.floor(ctx.tableWidthDxa / totalCols / 15) - 20) }

  const borders = {
    top: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
    bottom: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
    left: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
    right: { style: BorderStyle.SINGLE, size: 8, color: borderColor },
  }

  const rows = []
  for (const tr of trs) {
    const cells = []
    for (const cell of Array.from(tr.querySelectorAll(':scope > th, :scope > td'))) {
      const isHeader = cell.tagName.toLowerCase() === 'th'
      const colSpan = clampSpan(cell.getAttribute('colspan'))
      const rowSpan = clampSpan(cell.getAttribute('rowspan'))

      const paras = []
      const pushP = async (n) => {
        if (n.nodeName === 'P') {
          paras.push(await paragraphFromP(n, cellCtx, isHeader ? { bold: true } : {}))
        } else if (n.nodeName === 'UL' || n.nodeName === 'OL') {
          const list = await processListNode(n, cellCtx, 0)
          paras.push(...list.paragraphs)
          numberingConfigs.push(...list.numberingConfigs)
        } else {
          for (const child of Array.from(n.childNodes || [])) await pushP(child)
        }
      }
      if (cell.childNodes.length) {
        for (const child of Array.from(cell.childNodes)) await pushP(child)
      }
      if (!paras.length) {
        paras.push(new Paragraph({ children: [new TextRun({ text: ' ', font: ctx.defaultFont })] }))
      }

      const bg = cssBackgroundToDocx(cell.style.backgroundColor)

      cells.push(
        new TableCell({
          children: paras,
          borders,
          margins: { top: CELL_PADDING, bottom: CELL_PADDING, left: CELL_PADDING, right: CELL_PADDING },
          verticalAlign: VerticalAlign.CENTER,
          shading: bg ? { fill: bg } : isHeader ? { fill: headerFill } : undefined,
          columnSpan: colSpan > 1 ? colSpan : undefined,
          rowSpan: rowSpan > 1 ? rowSpan : undefined,
        }),
      )
    }
    rows.push(new TableRow({ children: cells }))
  }

  const table = new Table({
    width: { size: ctx.tableWidthDxa, type: WidthType.DXA },
    alignment: AlignmentType.LEFT,
    layout: TableLayoutType.FIXED,
    columnWidths,
    rows,
  })
  return { table, numberingConfigs }
}

/**
 * Recursively turns a node list into docx block children. Handles a stray
 * tab wrapper div (`<div data-tab-id>` — present when the editor emits a
 * single tab's content, e.g. the "current tab only" export) by unwrapping
 * it, plus image galleries, page breaks, dividers, and a generic-container
 * fallback so nothing silently collapses into one mangled paragraph.
 * Multi-tab heading/page-break separation is handled by the caller in
 * `downloadDocxFromHtml`, not here — see that function for why.
 *
 * Returns { blocks, numberingConfigs }: list numbering configs are
 * discovered only where a <ul>/<ol> is found, so each recursive call
 * returns its own and the caller merges them, rather than every call
 * reaching into a shared, mutated collection.
 */
async function blocksFromNodes(nodeList, ctx) {
  const out = []
  const numberingConfigs = []
  for (const node of Array.from(nodeList)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node
    const tag = el.tagName.toLowerCase()

    if (tag === 'div' && el.hasAttribute('data-tab-id')) {
      const nested = await blocksFromNodes(el.childNodes, ctx)
      out.push(...nested.blocks)
      numberingConfigs.push(...nested.numberingConfigs)
    } else if (tag === 'div' && el.getAttribute('data-type') === 'image-group') {
      out.push(...(await blocksForImageGroup(el, ctx)))
    } else if (tag === 'div' && el.hasAttribute('data-page-break')) {
      out.push(new Paragraph({ children: [new PageBreak()] }))
    } else if (tag === 'p') {
      out.push(await paragraphFromP(el, ctx))
    } else if (tag === 'ul' || tag === 'ol') {
      const list = await processListNode(el, ctx, 0)
      out.push(...list.paragraphs)
      numberingConfigs.push(...list.numberingConfigs)
    } else if (/^h[1-6]$/.test(tag)) {
      out.push(await headingFromHx(el, ctx))
    } else if (tag === 'blockquote') {
      out.push(...(await paragraphsFromBlockquote(el, ctx)))
    } else if (tag === 'pre') {
      out.push(paragraphFromCodeBlock(el, ctx))
    } else if (tag === 'table') {
      out.push(new Paragraph({ children: [], spacing: { before: TABLE_SPACE_BEFORE } }))
      const tableResult = await tableFromTABLE(el, ctx)
      out.push(tableResult.table)
      numberingConfigs.push(...tableResult.numberingConfigs)
      out.push(new Paragraph({ children: [], spacing: { after: TABLE_SPACE_AFTER } }))
    } else if (tag === 'img') {
      const p = await imageParagraph(el, ctx)
      if (p) out.push(p)
    } else if (tag === 'hr') {
      out.push(dividerParagraph(ctx))
    } else if (tag === 'video') {
      out.push(blockForVideo(el, ctx))
    } else if (tag === 'iframe') {
      out.push(blockForIframe(el, ctx))
    } else {
      const hasBlockChildren = Array.from(el.children || []).some((c) => BLOCK_TAGS.has(c.tagName))
      if (hasBlockChildren) {
        const nested = await blocksFromNodes(el.childNodes, ctx)
        out.push(...nested.blocks)
        numberingConfigs.push(...nested.numberingConfigs)
      } else {
        out.push(await paragraphFromP(el, ctx))
      }
    }
  }
  return { blocks: out, numberingConfigs }
}

export async function downloadDocxFromHtml(html, filename, settings = {}) {
  const fontSetting = settings?.font_family || settings?.fontFamily

  const fontMap = {
    caveat: 'var(--font-caveat)',
    'comic-sans': 'var(--font-comic-sans)',
    comfortaa: 'var(--font-comfortaa)',
    'eb-garamond': 'var(--font-eb-garamond)',
    fantasy: 'fantasy',
    geist: 'var(--font-geist)',
    'ibm-plex': 'var(--font-ibm-plex)',
    inter: 'var(--font-inter)',
    jetbrains: 'var(--font-jetbrains)',
    lora: 'var(--font-lora)',
    merriweather: 'var(--font-merriweather)',
    nunito: 'var(--font-nunito)',
  }

  const fontVar = fontMap[fontSetting] || fontSetting
  const defaultFont = cssFontToDocx(fontVar) || 'Inter'
  const baseFontSize = pxToDocxSize(settings?.font_size ?? 15) || 28

  const defaultSpacing = {
    before: pxToTwips(settings?.paragraph_spacing_before),
    after: pxToTwips(settings?.paragraph_spacing_after),
    line: toDocxLine(settings?.line_height),
    lineRule: 'auto',
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body

  const topTabs = Array.from(body.children).filter(
    (c) => c.tagName === 'DIV' && c.hasAttribute('data-tab-id'),
  )

  const ctx = {
    defaultFont,
    defaultSpacing,
    tableWidthDxa: CONTENT_WIDTH_TWIPS,
    contentWidthPx: CONTENT_WIDTH_PX,
  }

  // Exporting every tab: build each tab's heading + content as one unit, in
  // an explicit indexed loop, then concatenate in order. This — rather than
  // a shared counter mutated mid-recursion — is what keeps tab numbering and
  // page-break placement correct regardless of traversal order.
  let children
  let numberingConfigs
  if (topTabs.length > 1) {
    children = []
    numberingConfigs = []
    for (const [index, tab] of topTabs.entries()) {
      children.push(
        new Paragraph({
          pageBreakBefore: index > 0,
          spacing: { before: 0, after: 200 },
          children: [
            new TextRun({ text: tab.getAttribute('data-tab-label') || 'Untitled', bold: true, size: 40, font: defaultFont }),
          ],
        }),
      )
      const tabResult = await blocksFromNodes(tab.childNodes, ctx)
      children.push(...tabResult.blocks)
      numberingConfigs.push(...tabResult.numberingConfigs)
    }
  } else {
    const result = await blocksFromNodes(body.childNodes, ctx)
    children = result.blocks
    numberingConfigs = result.numberingConfigs
  }

  const docxDoc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: defaultFont,
            size: baseFontSize,
            color: '000000',
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Normal',
          name: 'Normal',
          run: {
            font: defaultFont,
            size: baseFontSize,
            color: '000000',
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: PAGE_MARGIN_TWIPS,
              right: PAGE_MARGIN_TWIPS,
              bottom: PAGE_MARGIN_TWIPS,
              left: PAGE_MARGIN_TWIPS,
            },
          },
        },
        children: children.length ? children : [emptyParagraph(ctx)],
      },
    ],
    numbering: numberingConfigs.length ? { config: numberingConfigs } : undefined,
  })

  const blob = await Packer.toBlob(docxDoc)
  fileSaver.saveAs(blob, filename.endsWith('.docx') ? filename : `${filename}.docx`)
}

export default downloadDocxFromHtml
export { tableFromTABLE }
