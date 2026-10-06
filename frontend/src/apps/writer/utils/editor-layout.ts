import { cssLineHeight } from './typography'

export type LayoutSettings = {
  wide?: boolean
  font_family?: string
  font_size?: number
  line_height?: number | string
  paragraph_spacing_before?: number
  paragraph_spacing_after?: number
} | null

export const EDITOR_TEXT_CLASS =
  'grow w-full bg-surface-base overflow-x-auto pt-10 pb-24 px-5 prose prose-sm prose-v3 prose-table:table-fixed prose-td:p-2 prose-th:p-2 prose-td:border prose-th:border prose-td:relative prose-th:relative prose-th:bg-surface-gray-2'

/** The editor's three columns: margin, text, and the comments margin. */
export function editorColumns(settings?: LayoutSettings) {
  return {
    gridTemplateColumns: `minmax(0, 1fr) minmax(0, ${settings?.wide ? '100ch' : '48rem'}) minmax(0, 1fr)`,
  }
}

export function editorTextStyle(settings?: LayoutSettings) {
  return {
    fontFamily: settings?.font_family && `var(--font-${settings.font_family})`,
    '--editor-font-size': `${settings?.font_size || 15}px`,
    '--editor-line-height': cssLineHeight(settings?.line_height),
    '--paragraph-spacing-before': `${settings?.paragraph_spacing_before || 0}px`,
    '--paragraph-spacing-after': `${settings?.paragraph_spacing_after || 0}px`,
  }
}
