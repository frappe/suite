import { ref, reactive, watch, nextTick } from 'vue'
import { Editor } from '@tiptap/vue-3'
import { createDocument } from '@tiptap/core'
import { extensions, patchEmptyParagraphs } from '@/apps/slides/stores/tiptapSetup'
import { Selection, TextSelection } from 'prosemirror-state'
import { cellAround } from 'prosemirror-tables'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { markDirty } from '@/apps/slides/stores/saving'
import {
	activeElement,
	findSlideElement,
	getInitialShapeTextContent,
} from '@/apps/slides/stores/element'
import { batchCommand, editElementCommand } from '@/apps/slides/stores/commands'
import { getElementDiv } from '@/apps/slides/stores/elementRegistry'
import { currentSlide } from '@/apps/slides/stores/slide'

export const activeEditor = ref(null)

// the default parse drops a line's leading spaces, so indentation lasts only until the
// content is read back. 'full' would turn the gaps in pretty-printed HTML into lines
const parseOptions = { preserveWhitespace: true }

// the element this editor was built for: activeElement flips a tick earlier
let editorElement = null
let editorSlideId = null
let lastCompositionId = null
let lastRenderedWidth = null
let stopContentWatch = null

let suppressRecording = false

// only auto-width text is worth the forced layout of an offsetWidth read;
// until EditorContent adopts the view the div is an empty shell, not a width
const measuredAutoWidth = (editor) => {
	if (editorElement?.type !== 'text' || editorElement.width) return null
	const div = getElementDiv(editorElement.id)
	if (!div || !editor?.view || !div.contains(editor.view.dom)) return null
	return div.offsetWidth
}

// a width the panel changed makes the stored baseline a lie, and the next transaction can
// only measure after the keystroke it should have anchored, so reseed off the settled DOM
export const resetGrowthBaseline = async () => {
	lastRenderedWidth = null
	await nextTick()
	lastRenderedWidth = measuredAutoWidth(activeEditor.value)
}

const withRecordingSuppressed = (fn) => {
	suppressRecording = true
	try {
		return fn()
	} finally {
		suppressRecording = false
	}
}

const patchedHTML = (html) => (html ? patchEmptyParagraphs(html).updatedHTML : html)

const isEditorLive = () => activeEditor.value && editorElement?.id === activeElement.value?.id

// history writes state; the mounted editor has to be told
const reconcileEditorContent = (html) => {
	if (!isEditorLive()) return

	const editor = activeEditor.value

	if (html == null) {
		if (activeElement.value?.type !== 'shape') return
		const seed = getInitialShapeTextContent(activeElement.value)
		withRecordingSuppressed(() =>
			editor.commands.setContent(seed, { emitUpdate: false, parseOptions }),
		)
		return
	}

	if (patchedHTML(editor.getHTML()) === html) return

	// setContent replaces the whole doc, mapping the selection to its end. the two
	// documents differ over one range, so a caret past it moves by the size change
	const incoming = createDocument(html, editor.schema, parseOptions)
	const { content } = editor.state.doc
	const start = content.findDiffStart(incoming.content)
	const { a: endHere, b: endThere } = start == null ? {} : content.findDiffEnd(incoming.content)

	const { from, to } = editor.state.selection
	const [carriedFrom, carriedTo] = [from, to].map((pos) => {
		if (start == null) return pos
		// the tail first: text inserted at the caret ends up behind it, the way
		// it does when you type it
		if (pos >= endHere) return pos + endThere - endHere
		return pos <= start ? pos : start
	})

	withRecordingSuppressed(() => {
		editor.commands.setContent(html, { emitUpdate: false, parseOptions })
		// between, so that endpoints a cell selection left on cell boundaries come back
		// as the nearest position that can hold a caret
		editor.commands.command(({ tr }) => {
			const { doc } = tr
			tr.setSelection(TextSelection.between(doc.resolve(carriedFrom), doc.resolve(carriedTo)))
			return true
		})
	})
}

const editorStyles = reactive({
	textAlign: null,
	lineHeight: null,
	bold: false,
	italic: false,
	strike: false,
	underline: false,
	textTransform: 'none',
	fontSize: null,
	fontFamily: null,
	color: null,
	letterSpacing: null,
	opacity: null,
	bulletList: false,
	orderedList: false,
	cellFill: null,
})

export const useTextEditor = () => {
	const setEditorStyles = (editor) => {
		if (!editor) return

		const activeStyles = editor.getAttributes('textStyle')

		Object.assign(editorStyles, {
			textAlign: editor.getAttributes('paragraph').textAlign || 'left',
			lineHeight: editor.getAttributes('paragraph').lineHeight || 1.5,
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			strike: editor.isActive('strike'),
			underline: editor.isActive('underline'),
			bulletList: editor.isActive('bulletList'),
			orderedList: editor.isActive('orderedList'),
			textTransform: activeStyles.textTransform || 'none',
			fontSize: parseInt(activeStyles.fontSize, 10) || null,
			fontFamily: activeStyles.fontFamily || null,
			color: activeStyles.color || null,
			letterSpacing: parseInt(activeStyles.letterSpacing, 10),
			opacity: activeStyles.opacity,
			cellFill:
				editor.getAttributes('tableCell').backgroundColor ||
				editor.getAttributes('tableHeader').backgroundColor ||
				null,
		})
	}

	const updateElementContent = (editor) => {
		if (!editorElement) return
		editorElement.content = patchedHTML(editor.getHTML())
		markDirty()
	}

	const growthAnchor = (editor) => {
		const aligns = new Set()
		editor.state.doc.descendants((node) => {
			if (node.isTextblock) aligns.add(node.attrs.textAlign || 'left')
		})
		return aligns.size === 1 ? aligns.values().next().value : 'left'
	}

	// centered and right-aligned text holds its anchor by paying growth out of left
	const applyGrowthShift = (editor) => {
		const width = measuredAutoWidth(editor)
		const previousWidth = lastRenderedWidth
		lastRenderedWidth = width

		if (width == null || previousWidth == null || width === previousWidth) return null

		const anchor = growthAnchor(editor)
		if (anchor !== 'center' && anchor !== 'right') return null

		const delta = width - previousWidth
		const oldValue = editorElement.left
		editorElement.left = oldValue - (anchor === 'center' ? delta / 2 : delta)
		return { oldValue, newValue: editorElement.left }
	}

	const recordContentEdit = (oldValue, transaction, leftShift) => {
		const compositionId = transaction.getMeta('composition')
		// an IME candidate pause routinely outlasts the coalesce window
		const forceCoalesce = compositionId != null && compositionId === lastCompositionId
		lastCompositionId = compositionId

		const newValue = editorElement.content
		if (!commandHistory || oldValue === newValue) return

		const contentCommand = editElementCommand({
			slideId: editorSlideId,
			elementIds: [editorElement.id],
			property: 'content',
			oldValue,
			newValue,
			coalesceKey: `content:${editorSlideId}:${editorElement.id}`,
		})

		if (editorElement.type !== 'text' || editorElement.width)
			return commandHistory.record(contentCommand, { forceCoalesce })

		// always the batch shape, so shifted and unshifted keystrokes coalesce
		const leftCommand = editElementCommand({
			slideId: editorSlideId,
			elementIds: [editorElement.id],
			property: 'left',
			oldValue: leftShift?.oldValue ?? editorElement.left,
			newValue: leftShift?.newValue ?? editorElement.left,
		})

		const command = batchCommand({
			slideId: editorSlideId,
			elementIds: [editorElement.id],
			commands: [contentCommand, leftCommand],
			// a side-handle drag can fix the width mid-burst, so the shapes must not coalesce
			coalesceKey: `content+left:${editorSlideId}:${editorElement.id}`,
		})

		commandHistory.record(command, { forceCoalesce })
	}

	const handleOnTransaction = (editor, transaction) => {
		// a caret placed in the mounted editor is the first sure chance to seed
		if (lastRenderedWidth == null) lastRenderedWidth = measuredAutoWidth(editor)
		if (!transaction.docChanged) return

		// purposefully using onTransaction + docChanged instead of onUpdate
		// since onUpdate also triggers when activeEditor changes from one text box to another
		// leading to overwriting content for second one with first one's content

		// history and init pushes still change the width, so the baseline follows
		if (suppressRecording || !editorElement) {
			lastRenderedWidth = measuredAutoWidth(editor)
			return setEditorStyles(editor)
		}

		const oldValue = patchedHTML(editorElement.content)

		updateElementContent(editor)
		const leftShift = applyGrowthShift(editor)
		setEditorStyles(editor)

		recordContentEdit(oldValue, transaction, leftShift)
	}

	const markCommands = {
		bold: 'toggleBold',
		italic: 'toggleItalic',
		strike: 'toggleStrike',
		underline: 'toggleUnderline',
	}

	// a cursor in a cell styles that cell, the whole element otherwise
	const selectStyleTarget = (chain) => {
		const editor = activeEditor.value
		const $cell = editor.isEditable ? cellAround(editor.state.selection.$head) : null
		if (!$cell) return chain.selectAll()

		// the cell's own boundaries can't hold a caret, and endpoints left on them
		// get normalised outwards into the next cell
		const { doc } = editor.state
		return chain.setTextSelection({
			from: Selection.near(doc.resolve($cell.pos + 1), 1).from,
			to: Selection.near(doc.resolve($cell.pos + $cell.nodeAfter.nodeSize - 1), -1).to,
		})
	}

	const toggleMark = (property) => {
		const currentEditor = activeEditor.value

		const chain = currentEditor.chain()

		const { empty } = currentEditor.state.selection
		if (empty) selectStyleTarget(chain)

		chain[markCommands[property]](property).run()
	}

	const selectListBlock = () => {
		const { state } = activeEditor.value
		const doc = state.doc

		let selectionStart = null,
			selectionEnd = null

		doc.descendants((node, pos) => {
			if (!node.isTextblock) return

			selectionEnd = pos + node.nodeSize - 1

			if (!selectionStart) {
				selectionStart = pos + 1
			}
		})

		if (selectionStart && selectionEnd) {
			const selection = TextSelection.create(doc, selectionStart, selectionEnd)
			const transaction = state.tr.setSelection(selection)
			activeEditor.value.view.dispatch(transaction)
		}
	}

	const getCSSString = (currentStyle, property, value) => {
		const val =
			property == 'opacity' ? `${value}%` : property == 'fontSize' ? `${value}px` : value
		const prop = property.replace(/([A-Z])/g, '-$1').toLowerCase()
		const newStyle = `${prop}: ${val}`
		return currentStyle ? `${currentStyle}; ${newStyle}` : newStyle
	}

	const getActiveListType = () => {
		if (activeEditor.value.isActive('orderedList')) return 'ordered'
		if (activeEditor.value.isActive('bulletList')) return 'bullet'
		return 'none'
	}

	const setListProperty = (value) => {
		if (!activeEditor.value.isEditable) selectListBlock()

		const current = getActiveListType()

		if (value == current) return

		const chain = activeEditor.value.chain()

		if (value == 'none') {
			chain.liftListItem('listItem').run()
			return
		}

		const listType = value == 'ordered' ? 'orderedList' : 'bulletList'

		if (current == 'none') {
			chain.wrapInList(listType).run()
		} else {
			chain.liftListItem('listItem').wrapInList(listType).run()
		}
	}

	const updateProperty = (property, value) => {
		const currentEditor = activeEditor.value

		const chain = currentEditor.chain()

		if (property == 'list') return setListProperty(value)

		const { empty } = currentEditor.state.selection
		if (empty) selectStyleTarget(chain)

		switch (property) {
			case 'textAlign':
				chain.setTextAlign(value).run()
				break
			case 'color':
				chain.setColor(value).run()
				break
			case 'lineHeight':
				activeEditor.value.commands.setGlobalLineHeight(value)
				break
			default:
				chain
					.setMark('textStyle', {
						[property]: value,
					})
					.run()
				break
		}
	}

	const initTextEditor = (id, content, isEditable = false, initialLineHeight = null) => {
		editorElement = findSlideElement(id)
		editorSlideId = currentSlide.value?.clientId
		lastCompositionId = null
		// two ticks: EditorContent reacts to the new editor, then adopts its view
		lastRenderedWidth = null
		nextTick(() =>
			nextTick(() => (lastRenderedWidth ??= measuredAutoWidth(activeEditor.value))),
		)

		stopContentWatch?.()
		stopContentWatch = watch(() => activeElement.value?.content, reconcileEditorContent)

		withRecordingSuppressed(() => {
			activeEditor.value = new Editor({
				extensions: extensions,
				editable: isEditable,
				content: content,
				parseOptions,
				// focus only lands once EditorContent has adopted the view, so tiptap
				// has to do it itself after mounting. 'all' inside a table would
				// select every cell, so tables start with a cursor in the first one
				autofocus: isEditable ? (editorElement?.type === 'table' ? 'start' : 'all') : false,
				// to update styles in sidebar based on cursor position
				onSelectionUpdate: ({ editor }) => setEditorStyles(editor),
				// to update element content on every change
				onTransaction: ({ editor, transaction }) =>
					handleOnTransaction(editor, transaction),
			})

			// If there is a legacy lineHeight to migrate for display, apply it in-memory
			if (initialLineHeight != null) {
				activeEditor.value.commands.setGlobalLineHeight(initialLineHeight)
				delete editorElement?.editorMetadata
			}
		})

		setEditorStyles(activeEditor.value)
	}

	return {
		activeEditor,
		editorStyles,
		toggleMark,
		updateProperty,
		initTextEditor,
	}
}
