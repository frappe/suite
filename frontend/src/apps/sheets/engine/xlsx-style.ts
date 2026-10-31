// XLSX styling adapter — maps our side stores (cell formats, the per-sheet
// view, conditional formats) to and from ExcelJS's style, column/row and
// conditional-formatting models. Pure functions only (no ExcelJS import), so
// the mapping is unit-testable; useExportImport owns the file I/O.
//
// Units: our sizes are CSS px, Excel's are not.
//   column width  Excel characters of the default font: px = chars * 7 + 5
//   row height    points: px = pt * 4 / 3
//   font size     whole points (Google's and Excel's pickers, and ExcelJS
//                 reads sizes with parseInt): our fontSize is px, so 13 px
//                 (our default) is 10 pt, and Google's 10 pt comes in as 13 px

import { cellId, parseCellId } from '../utils/cells.js'
import { FONT_FAMILY_STACK } from '../utils/font-stacks.js'
import { displayNumber } from '../utils/format-number.js'
import type { CfCondition, CfRule } from './cond-format.js'
import type { Format } from './formats.js'
import type { Rect } from './types.js'

// ── ExcelJS shapes (the fields this module reads or writes) ─────────────────

interface XColor {
  argb?: string
  theme?: number
  tint?: number
  indexed?: number
}
interface XFont {
  name?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean | string
  strike?: boolean
  color?: XColor
}
interface XFill {
  type?: string
  pattern?: string
  fgColor?: XColor
  bgColor?: XColor
}
interface XAlignment {
  horizontal?: string
  vertical?: string
  wrapText?: boolean
}
interface XBorderSide {
  style?: string
  color?: XColor
}
interface XBorder {
  top?: XBorderSide
  bottom?: XBorderSide
  left?: XBorderSide
  right?: XBorderSide
}
interface XStyle {
  font?: XFont
  fill?: XFill
  alignment?: XAlignment
  border?: XBorder
}
interface XCfvo {
  type: string
  value?: number
}
interface XCfRule {
  type: string
  operator?: string
  priority?: number
  formulae?: (string | number)[]
  text?: string
  style?: { fill?: XFill; font?: XFont }
  cfvo?: XCfvo[]
  color?: XColor | XColor[]
  iconSet?: string
}
interface XConditionalFormatting {
  ref: string
  rules: XCfRule[]
}

// ── Colours ──────────────────────────────────────────────────────────────────

// Office's default theme: index 0 lt1, 1 dk1, 2 lt2, 3 dk2, 4–9 accent1–6,
// the order SpreadsheetML numbers theme colours in.
const OFFICE_THEME = [
  'FFFFFF',
  '000000',
  'E7E6E6',
  '44546A',
  '4472C4',
  'ED7D31',
  'A5A5A5',
  'FFC000',
  '5B9BD5',
  '70AD47',
]

/**
 * The theme colours of a theme1.xml, in SpreadsheetML's order (lt1, dk1, lt2,
 * dk2, accents); Office's defaults where the file has none.
 */
export function themePalette(xml: string | null | undefined): string[] {
  const hex = (tag: string) => {
    const m = xml?.match(
      new RegExp(`<a:${tag}>\\s*<a:(?:srgbClr val|sysClr[^>]*lastClr)="([0-9A-Fa-f]{6})"`),
    )
    return m?.[1]?.toUpperCase()
  }
  const file = [
    'lt1',
    'dk1',
    'lt2',
    'dk2',
    'accent1',
    'accent2',
    'accent3',
    'accent4',
    'accent5',
    'accent6',
  ].map(hex)
  return OFFICE_THEME.map((d, i) => file[i] || d)
}

// '#cfe2f3' → 'FFCFE2F3'; null for anything that isn't #rgb / #rrggbb.
function _argb(hex: unknown): string | null {
  const m = String(hex ?? '').match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!
  return 'FF' + h.toUpperCase()
}

// An ExcelJS colour → '#rrggbb', or null when it has none we can read.
function _hex(color: XColor | undefined, theme: string[]): string | null {
  if (!color) return null
  let rgb: string | undefined
  if (color.argb && /^[0-9a-f]{8}$/i.test(color.argb)) rgb = color.argb.slice(2)
  else if (color.theme != null) rgb = theme[color.theme]
  if (!rgb) return null
  const tint = color.tint ?? 0
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(rgb!.slice(i, i + 2), 16)
    const t = tint < 0 ? c * (1 + tint) : c + (255 - c) * tint
    return Math.round(t).toString(16).padStart(2, '0')
  })
  return '#' + ch.join('')
}

// ── Cell formats ─────────────────────────────────────────────────────────────

// Our font stacks as an Excel font name; System has none (Excel's default).
const STACK_NAME: Record<string, string> = {
  [FONT_FAMILY_STACK.inter!]: 'Inter',
  [FONT_FAMILY_STACK.serif!]: 'Georgia',
  [FONT_FAMILY_STACK.mono!]: 'Consolas',
}
const BORDER_SIDES = [
  ['borderTop', 'top'],
  ['borderBottom', 'bottom'],
  ['borderLeft', 'left'],
  ['borderRight', 'right'],
] as const
const VALIGN_TO: Record<string, string> = { top: 'top', middle: 'middle', bottom: 'bottom' }
const VALIGN_FROM: Record<string, string> = {
  top: 'top',
  middle: 'middle',
  center: 'middle',
  bottom: 'bottom',
}

function _fontName(stack: unknown): string | null {
  if (typeof stack !== 'string' || !stack) return null
  if (stack in STACK_NAME) return STACK_NAME[stack]!
  if (stack === FONT_FAMILY_STACK.system) return null
  // Any other stack: its first family.
  return (
    stack
      .split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '') || null
  )
}

function _fontStack(name: string): string {
  if (/mono|courier|consolas|menlo/i.test(name)) return FONT_FAMILY_STACK.mono!
  if (/^inter$/i.test(name)) return FONT_FAMILY_STACK.inter!
  if (/serif/i.test(name) && !/sans/i.test(name)) return FONT_FAMILY_STACK.serif!
  if (/times|georgia|cambria|garamond|palatino|baskerville/i.test(name))
    return FONT_FAMILY_STACK.serif!
  return `"${name}", ${FONT_FAMILY_STACK.inter}`
}

interface BorderSpec {
  style?: string
  color?: string
}

/** The format keys a cell's look comes from (formats.ts stores them untyped). */
interface StyleFormat {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: unknown
  fontFamily?: unknown
  color?: string
  backgroundColor?: string
  bg?: string
  align?: string
  valign?: string
  textWrap?: string
  wrapText?: boolean
  borderTop?: BorderSpec
  borderBottom?: BorderSpec
  borderLeft?: BorderSpec
  borderRight?: BorderSpec
}

/** Our cell format → an ExcelJS style (the number format goes separately). */
export function styleToXlsx(fmt: Format | null | undefined): XStyle {
  const f = (fmt || {}) as StyleFormat
  const style: XStyle = {}
  const font: XFont = {}
  if (f.bold) font.bold = true
  if (f.italic) font.italic = true
  if (f.underline) font.underline = true
  if (f.strikethrough) font.strike = true
  if (typeof f.fontSize === 'number' && f.fontSize > 0) font.size = Math.round(f.fontSize * 0.75)
  const name = _fontName(f.fontFamily)
  if (name) font.name = name
  const ink = _argb(f.color)
  if (ink) font.color = { argb: ink }
  // ExcelJS gives a style with no font its default, Calibri 11, and a font
  // with no name or size none. Spelled out, every cell carries the same
  // default font, as in Excel's files, so commonFont finds it on import.
  if (Object.keys(font).length) style.font = { name: 'Calibri', size: 11, ...font }

  const bg = _argb(f.backgroundColor || f.bg)
  if (bg) style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }

  const al: XAlignment = {}
  if (f.align === 'left' || f.align === 'center' || f.align === 'right') al.horizontal = f.align
  const valign = VALIGN_TO[f.valign ?? '']
  if (valign) al.vertical = valign
  if (f.textWrap === 'wrap' || (f.textWrap == null && f.wrapText === true)) al.wrapText = true
  if (Object.keys(al).length) style.alignment = al

  const border: XBorder = {}
  for (const [ours, side] of BORDER_SIDES) {
    const b = f[ours]
    if (!b) continue
    const s = b.style === 'medium' || b.style === 'thick' ? b.style : 'thin'
    border[side] = { style: s, color: { argb: _argb(b.color) || 'FF000000' } }
  }
  if (Object.keys(border).length) style.border = border
  return style
}

/**
 * What a file's cells mostly use, so it reads as "no format" (Google writes
 * Arial 10 on every cell, Excel Calibri 11). `name`/`size` undefined = absent.
 */
interface FontDefault {
  name?: string | undefined
  size?: number | undefined
}

/**
 * The most common font name and size among these styles' fonts (a font with
 * no size counts as one more size). Styles with no font are left out.
 */
export function commonFont(styles: Iterable<XStyle | undefined>): FontDefault {
  const names = new Map<string | undefined, number>()
  const sizes = new Map<number | undefined, number>()
  for (const s of styles) {
    if (!s?.font) continue
    names.set(s.font.name, (names.get(s.font.name) || 0) + 1)
    sizes.set(s.font.size, (sizes.get(s.font.size) || 0) + 1)
  }
  const top = <K>(m: Map<K, number>) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0]
  return { name: top(names), size: top(sizes) }
}

/**
 * An ExcelJS style → our cell format. Black text and white fills are left
 * out (they read as the default, and a literal black would vanish in dark
 * mode), and so is the file's common font.
 */
export function styleFromXlsx(
  style: XStyle | null | undefined,
  { theme = OFFICE_THEME, font: base = {} }: { theme?: string[]; font?: FontDefault } = {},
): Format {
  const fmt: Format = {}
  const font = style?.font
  if (font) {
    if (font.bold) fmt.bold = true
    if (font.italic) fmt.italic = true
    if (font.underline && font.underline !== 'none') fmt.underline = true
    if (font.strike) fmt.strikethrough = true
    if (font.size && font.size !== base.size) fmt.fontSize = Math.round((font.size * 4) / 3)
    if (font.name && font.name !== base.name) fmt.fontFamily = _fontStack(font.name)
    const ink = _hex(font.color, theme)
    if (ink && ink !== '#000000') fmt.color = ink
  }
  const fill = style?.fill
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const bg = _hex(fill.fgColor, theme) || _hex(fill.bgColor, theme)
    if (bg && bg !== '#ffffff') fmt.backgroundColor = bg
  }
  const al = style?.alignment
  if (al) {
    const h = al.horizontal === 'centerContinuous' ? 'center' : al.horizontal
    if (h === 'left' || h === 'center' || h === 'right') fmt.align = h
    if (al.vertical && VALIGN_FROM[al.vertical]) fmt.valign = VALIGN_FROM[al.vertical]
    if (al.wrapText) fmt.textWrap = 'wrap'
  }
  for (const [ours, side] of BORDER_SIDES) {
    const b = style?.border?.[side]
    if (!b?.style) continue
    const s = ['medium', 'thick'].includes(b.style)
      ? b.style
      : /double|thick/.test(b.style)
        ? 'thick'
        : 'thin'
    fmt[ours] = { style: s, color: _hex(b.color, theme) || '#000000' }
  }
  return fmt
}

// ── Sizes ────────────────────────────────────────────────────────────────────

/** Column width px → Excel characters. */
export function colWidthToXlsx(px: number): number {
  return Math.max(0, Math.round(((px - 5) / 7) * 100) / 100)
}
/** Excel characters → column width px. */
export function colWidthFromXlsx(chars: number): number {
  return Math.round(chars * 7 + 5)
}
/** Row height px → points. */
export function rowHeightToXlsx(px: number): number {
  return Math.round(px * 0.75 * 100) / 100
}
/** Points → row height px. */
export function rowHeightFromXlsx(pt: number): number {
  return Math.round((pt * 4) / 3)
}

/**
 * The rows (0-based) of a worksheet's XML whose height was set by hand
 * (`customHeight`). Excel also writes a height for rows it fitted to their
 * text, and ExcelJS reads both the same.
 */
export function customHeightRows(sheetXml: string): Set<number> {
  const rows = new Set<number>()
  for (const [tag] of sheetXml.matchAll(/<row\b[^>]*>/g)) {
    const r = tag.match(/\br="(\d+)"/)?.[1]
    if (r && /\bcustomHeight="(1|true)"/.test(tag)) rows.add(Number(r) - 1)
  }
  return rows
}

// ── Conditional formats ──────────────────────────────────────────────────────

const OPERATOR: Record<string, string> = {
  gt: 'greaterThan',
  lt: 'lessThan',
  gte: 'greaterThanOrEqual',
  lte: 'lessThanOrEqual',
  eq: 'equal',
  neq: 'notEqual',
  between: 'between',
}
const OPERATOR_FROM = Object.fromEntries(Object.entries(OPERATOR).map(([k, v]) => [v, k]))
const ICON_SET: Record<string, string> = {
  arrows3: '3Arrows',
  circles3: '3TrafficLights1',
  traffic3: '3TrafficLights2',
}
const ICON_SET_FROM: Record<string, string> = {
  '3Arrows': 'arrows3',
  '3ArrowsGray': 'arrows3',
  '3TrafficLights1': 'circles3',
  '3TrafficLights2': 'traffic3',
  '3Signs': 'traffic3',
}

/** A range as A1 text ('B2:B6', or 'B2' for one cell). */
function rectToRef({ r0, c0, r1, c1 }: Rect): string {
  const a = cellId(r0, c0)
  return r0 === r1 && c0 === c1 ? a : `${a}:${cellId(r1, c1)}`
}

/** Every range of an sqref ('A1:B5 D2' → two rects). */
export function refToRects(ref: string): Rect[] {
  const out: Rect[] = []
  for (const part of String(ref || '')
    .trim()
    .split(/\s+/)) {
    const [a, b = a] = part.split(':')
    const s = parseCellId((a || '').replace(/\$/g, '').toUpperCase()),
      e = parseCellId((b || '').replace(/\$/g, '').toUpperCase())
    if (!s || !e) continue
    const [r0, r1] = [s.row, e.row].sort((x, y) => x - y) as [number, number]
    const [c0, c1] = [s.col, e.col].sort((x, y) => x - y) as [number, number]
    out.push({ r0, c0, r1, c1 })
  }
  return out
}

// A comparison value as a formula operand: the number when it is one, else
// a quoted string.
function _operand(v: unknown): string {
  const n = displayNumber(v)
  return isNaN(n) ? _quote(v) : String(n)
}

function _quote(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

function _dxf(format: CfRule['format']): NonNullable<XCfRule['style']> {
  const style: NonNullable<XCfRule['style']> = {}
  const bg = _argb(format?.backgroundColor)
  // A dxf's solid fill colour is bgColor; Google writes fgColor too, for
  // readers that look there.
  if (bg)
    style.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg }, bgColor: { argb: bg } }
  const ink = _argb(format?.color)
  if (ink) style.font = { color: { argb: ink } }
  return style
}

/** One of our conditional-format rules → ExcelJS, or null when it has no xlsx form. */
export function cfToXlsx(rule: CfRule): XConditionalFormatting | null {
  const ref = rectToRef(rule.range)
  const tl = cellId(rule.range.r0, rule.range.c0)
  let x: XCfRule | null = null
  if (rule.kind === 'color-scale') {
    const s = rule.scale || {}
    const three = s.variant === '3color'
    x = {
      type: 'colorScale',
      cfvo: three
        ? [
            { type: 'min' },
            { type: 'percent', value: Math.round((s.midPercent ?? 0.5) * 100) },
            { type: 'max' },
          ]
        : [{ type: 'min' }, { type: 'max' }],
      color: (three ? [s.minColor, s.midColor, s.maxColor] : [s.minColor, s.maxColor]).map((c) => ({
        argb: _argb(c) || 'FFFFFFFF',
      })),
    }
  } else if (rule.kind === 'data-bar') {
    x = {
      type: 'dataBar',
      cfvo: [{ type: 'min' }, { type: 'max' }],
      color: { argb: _argb(rule.bar?.color) || 'FF638EC6' },
    }
  } else if (rule.kind === 'icon-set') {
    const [lo, hi] = rule.icons?.thresholds || [0.33, 0.66]
    x = {
      type: 'iconSet',
      iconSet: ICON_SET[rule.icons?.set || ''] || '3Arrows',
      cfvo: [
        { type: 'percent', value: 0 },
        { type: 'percent', value: Math.round(lo * 100) },
        { type: 'percent', value: Math.round(hi * 100) },
      ],
    }
  } else if (rule.condition) {
    const { type, value, value2 } = rule.condition
    const style = _dxf(rule.format)
    if (OPERATOR[type]) {
      const formulae = [_operand(value)]
      if (type === 'between') formulae.push(_operand(value2))
      x = { type: 'cellIs', operator: OPERATOR[type], formulae, style }
    } else if (type === 'contains') {
      // As a formula: ExcelJS writes a containsText rule without its `text`
      // attribute, which Google reads as "contains nothing" (every cell).
      x = {
        type: 'expression',
        formulae: [`NOT(ISERROR(SEARCH(${_quote(value)},${tl})))`],
        style,
      }
    } else if (type === 'notcontains') {
      x = {
        type: 'expression',
        formulae: [`ISERROR(SEARCH(${_quote(value)},${tl}))`],
        style,
      }
    } else if (type === 'empty') {
      x = { type: 'containsText', operator: 'containsBlanks', style }
    } else if (type === 'notempty') {
      x = { type: 'containsText', operator: 'notContainsBlanks', style }
    } else if (type === 'formula' && value) {
      x = { type: 'expression', formulae: [String(value).replace(/^=/, '')], style }
    }
  }
  return x ? { ref, rules: [x] } : null
}

// A formula operand back to our comparison value: a quoted string unquoted.
function _value(f: unknown): string {
  const s = String(f ?? '').trim()
  const m = s.match(/^"(.*)"$/)
  return m ? m[1]!.replace(/""/g, '"') : s
}

function _format(style: XCfRule['style'], theme: string[]): NonNullable<CfRule['format']> {
  const format: NonNullable<CfRule['format']> = {}
  const fill = style?.fill
  const bg = _hex(fill?.bgColor, theme) || _hex(fill?.fgColor, theme)
  if (bg) format.backgroundColor = bg
  const ink = _hex(style?.font?.color, theme)
  if (ink) format.color = ink
  return format
}

// The colour-scale stop a cfvo puts at, 0..1; null for one we can't place.
function _stop(v: XCfvo | undefined): number | null {
  if (!v) return null
  if (v.type === 'percent' || v.type === 'percentile') return (Number(v.value) || 0) / 100
  return null
}

const COMPARE: Record<string, string> = {
  '>': 'gt',
  '<': 'lt',
  '>=': 'gte',
  '<=': 'lte',
  '=': 'eq',
  '<>': 'neq',
}

// An Excel formula rule is worked out for each cell of its range, relative
// to the range's top-left cell `tl`. One that only tests that cell against a
// number or for blank is the matching rule of ours; null for any other
// (ours can't evaluate formulas).
function _selfCondition(f: string, tl: string): CfCondition | null {
  const s = f.replace(/\s+/g, '').toUpperCase()
  const cmp = s.match(/^([A-Z]+\d+)(>=|<=|<>|>|<|=)(-?\d+(?:\.\d+)?)$/)
  if (cmp && cmp[1] === tl) return { type: COMPARE[cmp[2]!]!, value: cmp[3]! }
  if (s === `ISBLANK(${tl})` || s === `LEN(TRIM(${tl}))=0`) return { type: 'empty' }
  if (s === `NOT(ISBLANK(${tl}))` || s === `LEN(TRIM(${tl}))>0`) return { type: 'notempty' }
  return null
}

/** One ExcelJS conditional formatting → our rules (one per range and rule), id-less. */
export function cfFromXlsx(
  cf: XConditionalFormatting,
  { theme = OFFICE_THEME }: { theme?: string[] } = {},
): Omit<CfRule, 'id'>[] {
  const out: Omit<CfRule, 'id'>[] = []
  const rects = refToRects(cf.ref)
  for (const x of cf.rules || []) {
    let rule: Omit<CfRule, 'id' | 'range'> | null = null
    const colors = (Array.isArray(x.color) ? x.color : x.color ? [x.color] : []).map(
      (c) => _hex(c, theme) || '#ffffff',
    )
    if (x.type === 'colorScale' && colors.length >= 2) {
      rule =
        colors.length >= 3
          ? {
              kind: 'color-scale',
              scale: {
                variant: '3color',
                minColor: colors[0]!,
                midColor: colors[1]!,
                maxColor: colors[2]!,
                midPercent: _stop(x.cfvo?.[1]) ?? 0.5,
              },
            }
          : {
              kind: 'color-scale',
              scale: { variant: '2color', minColor: colors[0]!, maxColor: colors[1]! },
            }
    } else if (x.type === 'dataBar') {
      rule = { kind: 'data-bar', bar: { color: colors[0] || '#638ec6' } }
    } else if (x.type === 'iconSet') {
      rule = {
        kind: 'icon-set',
        icons: {
          set: ICON_SET_FROM[x.iconSet || ''] || 'circles3',
          thresholds: [_stop(x.cfvo?.[1]) ?? 0.33, _stop(x.cfvo?.[2]) ?? 0.66],
        },
      }
    } else if (x.type === 'cellIs' && x.operator && OPERATOR_FROM[x.operator]) {
      const condition: NonNullable<CfRule['condition']> = {
        type: OPERATOR_FROM[x.operator]!,
        value: _value(x.formulae?.[0]),
      }
      if (condition.type === 'between') condition.value2 = _value(x.formulae?.[1])
      rule = { condition, format: _format(x.style, theme) }
    } else if (x.type === 'containsText') {
      const type =
        x.operator === 'containsBlanks'
          ? 'empty'
          : x.operator === 'notContainsBlanks'
            ? 'notempty'
            : x.operator === 'containsText'
              ? 'contains'
              : null
      if (type)
        rule = {
          condition: { type, ...(type === 'contains' && { value: x.text ?? '' }) },
          format: _format(x.style, theme),
        }
    } else if (x.type === 'expression' && x.formulae?.[0] != null) {
      const f = String(x.formulae[0])
      // Our "contains" and "does not contain", as written above.
      const search = f.match(/^(NOT\()?ISERROR\(SEARCH\(("(?:[^"]|"")*"),[A-Z]+\d+\)\)(\))?$/i)
      const contains = search && !!search[1] === !!search[3]
      const tl = rects[0] && cellId(rects[0].r0, rects[0].c0)
      rule = {
        condition: contains
          ? { type: search[1] ? 'contains' : 'notcontains', value: _value(search[2]) }
          : (tl && _selfCondition(f, tl)) || { type: 'formula', value: '=' + f },
        format: _format(x.style, theme),
      }
    }
    if (rule) for (const range of rects) out.push({ ...rule, range })
  }
  return out
}
