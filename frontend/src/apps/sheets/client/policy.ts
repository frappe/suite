import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  save_ai_settings: { invalidates: ['get_ai_settings'] },
  spreadsheet_create: { invalidates: ['drive.node_children', 'drive.view_list'] },
  spreadsheet_cells_write: {
    invalidates: ['spreadsheet_read', 'spreadsheet_values', 'drive.view_list'],
  },
  spreadsheet_rows_append: {
    invalidates: ['spreadsheet_read', 'spreadsheet_values', 'drive.view_list'],
  },
  spreadsheet_sheet_add: {
    invalidates: ['spreadsheet_read', 'spreadsheet_values', 'drive.view_list'],
  },
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = Object.entries(effects).find(([id]) => id === reference.id)?.[1]
    if (!effect) throw new TypeError(`Missing sheets effects: ${reference.id}`)
    return { effects: effect }
  },
}
