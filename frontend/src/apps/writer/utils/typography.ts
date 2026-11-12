/**
 * Google Docs (and Word) treat line spacing as a multiple of the font's natural
 * line height — roughly 1.2em — so "1.15" there lands near 1.38em. CSS
 * line-height multiplies the font size directly, so the same number renders
 * noticeably tighter.
 *
 * Settings and paragraph attributes keep storing CSS values; these convert at
 * the UI boundary so the number a user types matches what Docs would do.
 */
const NORMAL_LINE_HEIGHT = 1.2

export const DEFAULT_LINE_HEIGHT = 1.5

export function toLineSpacing(cssLineHeight: number | string | null | undefined): number {
  const css = Number(cssLineHeight) || DEFAULT_LINE_HEIGHT
  return Math.round((css / NORMAL_LINE_HEIGHT) * 100) / 100
}

export function toCssLineHeight(spacing: number | string | null | undefined): number {
  const multiple = Number(spacing)
  if (!multiple || multiple <= 0) return DEFAULT_LINE_HEIGHT
  return Math.round(multiple * NORMAL_LINE_HEIGHT * 1000) / 1000
}

/** A settings value can be unset or the string `global`; fall back to the default. */
export function cssLineHeight(value: number | string | null | undefined): number {
  const css = Number(value)
  return css > 0 ? css : DEFAULT_LINE_HEIGHT
}

/** DOCX `spacing.line` is in 240ths of a single (natural) line. */
export function toDocxLine(cssLineHeight: number | string | null | undefined): number {
  return Math.round((240 * (Number(cssLineHeight) || DEFAULT_LINE_HEIGHT)) / NORMAL_LINE_HEIGHT)
}

/** CSS px → twips (1px = 0.75pt, 1pt = 20 twips). */
export function pxToTwips(px: number | string | null | undefined): number {
  return Math.round((parseFloat(String(px)) || 0) * 15)
}
