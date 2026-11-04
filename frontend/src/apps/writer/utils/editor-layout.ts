import { cssLineHeight } from './typography'

export type LayoutSettings = {
  font_family?: string
  font_size?: number
  line_height?: number | string
  paragraph_spacing_before?: number
  paragraph_spacing_after?: number
} | null

const DEFAULT_FONT_SIZE_PX = 15

export const EDITOR_TEXT_CLASS =
  'grow w-full bg-surface-base overflow-x-auto pt-10 pb-[40vh] px-5 prose prose-sm prose-v3 prose-table:table-fixed prose-td:relative prose-th:relative'

/** The editor's three columns: margin, text, and the comments margin. */
export function editorColumns() {
  return { gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 48rem) minmax(0, 1fr)' }
}

export function editorTextStyle(settings?: LayoutSettings) {
  const fontSize = settings?.font_size || DEFAULT_FONT_SIZE_PX
  const spacingBefore = settings?.paragraph_spacing_before || 0
  const spacingAfter = settings?.paragraph_spacing_after || 0
  return {
    fontFamily: settings?.font_family && `var(--font-${settings.font_family})`,
    '--editor-font-size': `${fontSize}px`,
    '--editor-line-height': cssLineHeight(settings?.line_height),
    '--paragraph-spacing-before': `${spacingBefore}px`,
    '--paragraph-spacing-after': `${spacingAfter}px`,
  }
}
