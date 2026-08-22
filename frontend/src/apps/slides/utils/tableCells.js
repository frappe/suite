import { CellSelection } from 'prosemirror-tables'

import { activeEditor } from '@/apps/slides/composables/useTextEditor'
import { getCells } from '@/apps/slides/stores/tiptapSetup'

// a table selected but not focused has its selection parked in the first cell, so the
// attribute would land on that one alone. Styling reads as whole-table there, the same
// way typography does
const selectWholeTable = ({ tr, editor }) => {
	if (editor.isEditable) return true

	const cells = getCells(tr.doc)
	if (!cells.length) return false

	tr.setSelection(CellSelection.create(tr.doc, cells[0].pos, cells[cells.length - 1].pos))
	return true
}

const setCellAttribute = (name, value) =>
	activeEditor.value?.chain().command(selectWholeTable).setCellAttribute(name, value).run()

export const setCellFill = (color) => setCellAttribute('backgroundColor', color)
