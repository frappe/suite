<template>
	<EditorContent
		v-if="showEditor"
		:editor="activeEditor"
		class="tableElement"
		:data-resizable-columns="canResizeColumns || null"
		:style="elementStyles"
		@mousedown="handleMouseDown"
		@dblclick="handleDoubleClick"
	/>
	<div
		v-else
		v-html="sanitizedContent"
		class="tableElement select-none"
		:style="elementStyles"
		@dblclick="handleDoubleClick"
	></div>
</template>

<script setup>
import { computed, inject, ref, watch } from 'vue'

import { EditorContent } from '@tiptap/vue-3'

import { sanitizeSlideHTML } from '@/apps/slides/utils/helpers'
import {
	getDefaultBandColor,
	getDefaultGridColor,
	isBackgroundColorDark,
} from '@/apps/slides/utils/color'
import {
	frameResizeAttribute,
	getTableWidth,
	restoreColumnWidths,
	stretchColumnsToFrame,
} from '@/apps/slides/utils/tableWidths'
import { isResizingColumn } from '@/apps/slides/utils/columnResizing'
import { selectionColor } from '@/apps/slides/utils/constants'

import { useTextEditor } from '@/apps/slides/composables/useTextEditor'
import { markDirty } from '@/apps/slides/stores/saving'
import { interactionOffset } from '@/apps/slides/stores/interaction'

import {
	focusElementId,
	activeElement,
	activeElementIds,
	setEditableState,
} from '@/apps/slides/stores/element'

const { activeEditor } = useTextEditor()

const props = defineProps({
	mode: {
		type: String,
		default: 'editor',
	},
})

const inReadonlyMode = inject('inReadonlyMode', ref(false))
const inSlideShowMode = inject('inSlideShowMode', ref(false))

const element = defineModel('element', {
	type: Object,
	default: null,
})

const showEditor = computed(
	() => props.mode == 'editor' && activeElement.value?.id == element.value.id,
)

const isEditable = computed(() => focusElementId.value == element.value.id)

// columns resize on a selected table, so this can't wait for the editable state
const canResizeColumns = computed(() => !inReadonlyMode.value && !element.value.locked)

// element.color tracks the slide background, so light text means a dark slide.
// The same tint reads far weaker against near-black, so it needs more of it there.
const headerTint = computed(() =>
	isBackgroundColorDark(element.value.color || '#000000') ? '5%' : '14%',
)

const elementStyles = computed(() => ({
	color: element.value.color,
	opacity: (element.value.opacity ?? 100) / 100,
	transform: `scale(${element.value.invertX || 1}, ${element.value.invertY || 1})`,
	cursor: isEditable.value ? 'text' : '',
	userSelect: isEditable.value ? 'text' : 'none',
	'--table-header-tint': headerTint.value,
	'--table-grid-color': element.value.gridColor || getDefaultGridColor(element.value.color),
	'--table-grid-width': `${element.value.gridWidth ?? 1}px`,
	'--table-band-color': element.value.bandedRows
		? element.value.bandColor || getDefaultBandColor(element.value.color)
		: 'transparent',
	'--table-resize-color': `${selectionColor}80`,
}))

const sanitizedContent = computed(() => sanitizeSlideHTML(element.value.content || ''))

// dragging a column border widens the table without touching the frame, and every
// consumer of element.width - handles, snapping, alignment, export - would drift
// from what is on screen. Undo restores the old columns and this follows them back,
// so the two agree at every point in history without recording anything itself.
watch(
	() => element.value.content,
	(content) => {
		if (props.mode !== 'editor') return

		const width = getTableWidth(content)
		if (!width || width === element.value.width) return

		element.value.width = width
		markDirty()
	},
)

const getTable = () => activeEditor.value?.view.dom.querySelector('table')

// a column drag previews itself by writing widths straight onto the table, so the
// frame around it has to follow within the drag rather than at mouseup. Nothing else
// in here moves the table, so a text selection drag reads the same width every time.
// The plugin has already claimed the event by now, and the element must not drag
// out from under a resize that started on it.
const handleMouseDown = (e) => {
	if (inReadonlyMode.value) return
	if (!isEditable.value && !isResizingColumn(activeEditor.value?.view)) return

	e.stopPropagation()

	const table = getTable()
	if (!table) return

	const followTableWidth = () => {
		const width = parseFloat(table.style.width)
		if (width && width !== element.value.width) element.value.width = width
	}

	window.addEventListener('mousemove', followTableWidth)
	window.addEventListener(
		'mouseup',
		() => window.removeEventListener('mousemove', followTableWidth),
		{ once: true },
	)
}

// the mark and the preview go on together, so a redraw between them can put it back
watch(
	() => interactionOffset.width,
	(offset) => {
		if (!showEditor.value) return

		const table = getTable()
		if (!table) return

		if (offset) {
			table.setAttribute(frameResizeAttribute, '')
			stretchColumnsToFrame(table)
		} else {
			table.removeAttribute(frameResizeAttribute)
			restoreColumnWidths(table)
		}
	},
)

const handleDoubleClick = (e) => {
	e.stopPropagation()
	if (inSlideShowMode.value || isEditable.value || inReadonlyMode.value || element.value.locked)
		return

	activeElementIds.value = [element.value.id]
	focusElementId.value = element.value.id

	if (activeElement.value.id == element.value.id && activeEditor.value) {
		setEditableState()
	}
}
</script>

<style>
.tableElement,
.tableElement .ProseMirror {
	font-family: Inter;
	font-size: 18px;
}

.tableElement table {
	border-collapse: collapse;
	table-layout: fixed;
}

/* qualified with `table` to outrank frappe-ui's global `.ProseMirror td/th`,
   which would otherwise style the editor render but not the static one */
.tableElement table td,
.tableElement table th {
	border: var(--table-grid-width, 1px) solid var(--table-grid-color, currentColor);
	padding: 6px 8px;
	vertical-align: top;
	overflow-wrap: break-word;
	background-color: transparent;
	/* the resize handle is a widget inside the cell it sits at the edge of */
	position: relative;
}

/* one per cell in the hovered column, stacking into a continuous line */
.tableElement .column-resize-handle {
	position: absolute;
	right: -1px;
	top: 0;
	bottom: 0;
	width: 2px;
	z-index: 20;
	background-color: var(--table-resize-color);
	pointer-events: none;
}

/* prosemirror-tables tags the cells, the stylesheet that draws them ships elsewhere */
.tableElement .selectedCell::after {
	content: '';
	position: absolute;
	inset: 0;
	background-color: color-mix(in srgb, var(--table-resize-color) 30%, transparent);
	pointer-events: none;
}

.tableElement .ProseMirror.resize-cursor {
	cursor: col-resize;
}

.tableElement table th {
	font-weight: 600;
	background-color: color-mix(in srgb, currentColor var(--table-header-tint, 5%), transparent);
}

/* a header row or column keeps its own tint, so only plain cells band */
.tableElement table tr:nth-child(even) td {
	background-color: var(--table-band-color);
}

.tableElement p {
	line-height: 1.5;
}

/* the editor fills an empty cell with a trailing break, the static render has
   nothing, so an empty row would collapse the moment editing stops */
.tableElement p:empty::before {
	content: '';
	display: inline-block;
}
</style>
