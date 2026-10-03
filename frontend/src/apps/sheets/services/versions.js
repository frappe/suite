// Client for the cell edit history the Sheets op log answers.
//
// Workbook versions (list, preview, restore, label) are Drive's: the surface's
// versions panel reads them through the document session. This module keeps
// the one query that has no Drive equivalent — the edits one cell has seen.

import { call } from '../utils/api.js'

const PREFIX = 'suite.sheets.versioning.api'

// `fetch` is the Drive session's, so a share link's holder is answered for
// the link they opened the sheet with.
export async function cellHistory(sheet, cellRef, sheetName = 'Sheet1', { limit = 50, fetch } = {}) {
	const ops = await call(`${PREFIX}.ops_for_cell`, {
		sheet,
		cell_id:   cellRef,
		sub_sheet: sheetName,
		limit,
	}, { fetch })
	// Adapter for CellHistoryPopover.vue's existing field names.
	return (ops || []).map(o => ({
		version:   o.id,
		timestamp: o.creation,
		user:      o.actor,
		before:    o.before,
		after:     o.after,
	}))
}
