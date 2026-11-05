import type { DocumentPanel } from '@/apps/drive'

/** The same keys as Google Docs, whose Ctrl/Cmd+Alt+M Writer already shares for commenting. */
export const PANEL_SHORTCUTS: Record<DocumentPanel, string> = {
  comments: 'Mod-Alt-Shift-a',
  versions: 'Mod-Alt-Shift-h',
}

// By physical key: Alt turns `event.key` into another character on a Mac
const PANEL_KEYS: Record<string, DocumentPanel> = { KeyA: 'comments', KeyH: 'versions' }

/** The panel this key press toggles, if any. */
export function panelPressed(event: KeyboardEvent): DocumentPanel | null {
  const isCombination = (event.metaKey || event.ctrlKey) && event.altKey && event.shiftKey
  return isCombination ? (PANEL_KEYS[event.code] ?? null) : null
}
