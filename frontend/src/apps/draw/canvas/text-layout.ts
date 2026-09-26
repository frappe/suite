import type { TextShape } from './scene'

export const TEXT_FONT_FAMILY = "'Shantell', cursive"
export const TEXT_LINE_HEIGHT = 1.25
export const TEXT_FONT_FAMILIES = {
  shantell: TEXT_FONT_FAMILY,
  inter: 'InterVar, ui-sans-serif, system-ui, sans-serif',
  georgia: 'Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const

export type TextLayout = { lines: string[]; width: number; contentWidth: number; height: number; lineHeight: number; baseline: number }

let context: CanvasRenderingContext2D | undefined

function fontDeclaration(fontSize: number, style: Pick<TextShape, 'fontFamily' | 'fontWeight' | 'fontStyle'> = {}): string {
  return `${style.fontStyle ?? 'normal'} ${style.fontWeight ?? 400} ${fontSize}px ${TEXT_FONT_FAMILIES[style.fontFamily ?? 'shantell']}`
}

function measure(text: string, fontSize: number, style?: Pick<TextShape, 'fontFamily' | 'fontWeight' | 'fontStyle'>): number {
  context ??= document.createElement('canvas').getContext('2d') ?? undefined
  if (!context) return text.length * fontSize * 0.6
  context.font = fontDeclaration(fontSize, style)
  return context.measureText(text).width
}

function wrappedLines(text: string, width: number, fontSize: number, style?: Pick<TextShape, 'fontFamily' | 'fontWeight' | 'fontStyle'>): string[] {
  const form = document.createElement('form')
  const input = document.createElement('textarea')
  input.name = 'text'
  input.cols = 1
  input.wrap = 'hard'
  input.value = text
  input.className = 'canvas-text-input'
  input.style.cssText = `width: ${width}px; font: ${fontDeclaration(fontSize, style)}; white-space: pre-wrap;`
  form.style.cssText = 'position: fixed; visibility: hidden; pointer-events: none;'
  form.append(input)
  document.body.append(form)
  // Hard wrapping exposes the textarea's actual line breaks without submitting anything.
  const wrapped = String(new FormData(form).get('text'))
  form.remove()
  return wrapped.replace(/\r\n?/g, '\n').split('\n')
}

export function layoutText(text: string, width: number, fontSize: number, wrap: boolean, style?: Pick<TextShape, 'fontFamily' | 'fontWeight' | 'fontStyle'>): TextLayout {
  const lines = wrap ? wrappedLines(text, Math.max(1, width), fontSize, style) : text.split('\n')
  const measuredWidth = lines.reduce((maximum, line) => Math.max(maximum, measure(line, fontSize, style)), fontSize)
  const lineHeight = fontSize * TEXT_LINE_HEIGHT
  if (context) context.font = fontDeclaration(fontSize, style)
  const metrics = context?.measureText('Hg')
  const ascent = metrics?.fontBoundingBoxAscent ?? fontSize * 0.8
  const descent = metrics?.fontBoundingBoxDescent ?? fontSize * 0.2
  const baseline = (lineHeight - ascent - descent) / 2 + ascent
  return { lines, width: wrap ? width : measuredWidth, contentWidth: measuredWidth, height: lines.length * lineHeight, lineHeight, baseline }
}
