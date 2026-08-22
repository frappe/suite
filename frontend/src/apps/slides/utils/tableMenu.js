import { activeEditor } from '@/apps/slides/composables/useTextEditor'
import { runTableCommand, distributeColumns, mergeCells } from '@/apps/slides/utils/tableStructure'
import { getTableSize } from '@/apps/slides/utils/tableWidths'

// the delete options go with the last row or column, matching the panel's count of 1
export const buildTableContextOptions = () => {
	const { rows, columns } = getTableSize(activeEditor.value.getHTML())

	const insertOptions = [
		{
			label: 'Row above',
			icon: 'lucide-between-horizontal-start',
			onClick: () => runTableCommand('addRowBefore'),
		},
		{
			label: 'Row below',
			icon: 'lucide-between-horizontal-end',
			onClick: () => runTableCommand('addRowAfter'),
		},
		{
			label: 'Column left',
			icon: 'lucide-between-vertical-start',
			onClick: () => runTableCommand('addColumnBefore'),
		},
		{
			label: 'Column right',
			icon: 'lucide-between-vertical-end',
			onClick: () => runTableCommand('addColumnAfter'),
		},
	]

	const modifyOptions = [
		{
			label: 'Merge cells',
			icon: 'lucide-table-cells-merge',
			condition: () => activeEditor.value.can().mergeCells(),
			onClick: () => mergeCells(),
		},
		{
			label: 'Split cell',
			icon: 'lucide-table-cells-split',
			condition: () => activeEditor.value.can().splitCell(),
			onClick: () => runTableCommand('splitCell'),
		},
		{
			label: 'Distribute columns',
			icon: 'lucide-align-horizontal-distribute-center',
			onClick: () => distributeColumns(),
		},
	]

	const deleteOptions = [
		{
			label: 'Delete row',
			icon: 'lucide-rows-3',
			condition: () => rows > 1,
			onClick: () => runTableCommand('deleteRow'),
		},
		{
			label: 'Delete column',
			icon: 'lucide-columns-3',
			condition: () => columns > 1,
			onClick: () => runTableCommand('deleteColumn'),
		},
	]

	return [
		{ group: 'Insert', options: insertOptions },
		{ group: 'Modify', options: modifyOptions },
		{ group: '', options: deleteOptions },
	]
}
