import { ref, reactive, watch, nextTick } from 'vue'
import { Editor } from '@tiptap/vue-3'
import { Editor as HeadlessEditor, createDocument } from '@tiptap/core'
import { extensions, patchEmptyParagraphs } from '@/apps/slides/stores/tiptapSetup'
import { EditorState, Selection, TextSelection } from 'prosemirror-state'
import { cellAround } from '@tiptap/pm/tables'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { markDirty } from '@/apps/slides/stores/saving'
import {
	activeElement,
	activeElementIds,
	activeElements,
	findSlideElement,
	firstEditableElement,
	getInitialShapeTextContent,
	hasTextContent,
	isMultiSelection,
	measureHTMLList,
} from '@/apps/slides/stores/element'
import { batchCommand, editElementCommand } from '@/apps/slides/stores/commands'
import { getElementDiv } from '@/apps/slides/stores/elementRegistry'
import { currentSlide } from '@/apps/slides/stores/slide'
import { throttleToFrame } from '@/apps/slides/utils/helpers'

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

// only an empty line takes anything from the patch, so a document without one skips the parse
const hasEmptyLine = (doc) => {
	let found = false
	doc.descendants((node) => {
		if (found || node.type.spec.isolating) return false
		if (node.type.name === 'paragraph') found = !node.textContent.trim()
		return !found
	})
	return found
}

// no view, so no DOM, no plugins and nothing the live editor could mistake for itself
let scratchEditor = null

// the edit the last step made per element, good while its content is still what that step
// wrote: the document skips the parse, the content the patch and the width the measure
let lastEdits = new Map()

const lastEdit = (element) => {
	const last = lastEdits.get(element.id)
	return last?.newContent === element.content ? last : null
}

const restoreDocument = (doc) => {
	const { schema, plugins } = scratchEditor.state
	scratchEditor.view.updateState(EditorState.create({ schema, plugins, doc }))
}

const parseContent = (element) => {
	scratchEditor.commands.setContent(element.content, { emitUpdate: false, parseOptions })

	// the same legacy seed initTextEditor applies, or the write bakes in the parsed default
	const lineHeight = element.editorMetadata?.lineHeight
	if (lineHeight != null) scratchEditor.commands.setGlobalLineHeight(lineHeight)
}

const loadScratchEditor = (element) => {
	scratchEditor ??= new HeadlessEditor({ element: null, editable: false, extensions, parseOptions })

	const last = lastEdit(element)
	if (last) restoreDocument(last.doc)
	else parseContent(element)

	// setContent leaves the selection at the end; the builders and the panel read the start
	scratchEditor.commands.setTextSelection(0)
	return scratchEditor
}

const canGrow = (element, anchor) =>
	element.type === 'text' && !element.width && (anchor === 'center' || anchor === 'right')

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

const listValues = { bulletList: 'bullet', orderedList: 'ordered' }

export const useTextEditor = () => {
	const setEditorStyles = (editor) => {
		if (!editor) return

		const activeStyles = editor.getAttributes('textStyle')
		const listType = getActiveListType(editor)

		Object.assign(editorStyles, {
			textAlign: editor.getAttributes('paragraph').textAlign || 'left',
			lineHeight: editor.getAttributes('paragraph').lineHeight || 1.5,
			bold: editor.isActive('bold'),
			italic: editor.isActive('italic'),
			strike: editor.isActive('strike'),
			underline: editor.isActive('underline'),
			bulletList: listType == 'bullet',
			orderedList: listType == 'ordered',
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
	const selectStyleTarget = (editor, chain) => {
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

	const toggleMarkOn = (editor, property) => {
		const chain = editor.chain()

		const { empty } = editor.state.selection
		if (empty) selectStyleTarget(editor, chain)

		chain[markCommands[property]](property).run()
	}

	const toggleMark = (property) =>
		isMultiSelection.value
			? toggleSelectedMark(property)
			: toggleMarkOn(activeEditor.value, property)

	const selectListBlock = (editor) => {
		const { state } = editor
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
			editor.view.dispatch(transaction)
		}
	}

	const getCSSString = (currentStyle, property, value) => {
		const val =
			property == 'opacity' ? `${value}%` : property == 'fontSize' ? `${value}px` : value
		const prop = property.replace(/([A-Z])/g, '-$1').toLowerCase()
		const newStyle = `${prop}: ${val}`
		return currentStyle ? `${currentStyle}; ${newStyle}` : newStyle
	}

	// the list each selected paragraph sits in directly, never an outer one
	const getActiveListType = (editor) => {
		const { doc, selection } = editor.state
		const found = new Set()
		doc.nodesBetween(selection.from, selection.to, (node, pos) => {
			if (!node.isTextblock) return
			found.add(listValues[doc.resolve(pos).node(-1)?.type.name] || 'none')
		})
		return found.size == 1 ? [...found][0] : 'mixed'
	}

	const setListProperty = (editor, value) => {
		if (!editor.isEditable) selectListBlock(editor)

		const current = getActiveListType(editor)

		if (value == current) return

		if (value == 'none') return clearLists(editor)

		applyListType(editor, value == 'ordered' ? 'orderedList' : 'bulletList')
	}

	// every selected paragraph leaves every list level it sits in
	const clearLists = (editor) =>
		editor.commands.command(({ tr, state, commands }) => {
			const { from, to } = state.selection
			const { listItem } = state.schema.nodes
			const paragraphs = []
			state.doc.nodesBetween(from, to, (node, pos) => {
				if (node.isTextblock) paragraphs.push(pos + 1)
			})

			// back to front, so a lift never moves one still to come
			paragraphs.reverse().forEach((pos) => {
				commands.setTextSelection(pos)
				// tiptap's chained state only catches up with the transaction when its tr is read
				while (state.tr.selection.$from.node(-1)?.type == listItem) {
					if (!commands.liftListItem('listItem')) break
				}
			})

			joinNeighbouringLists(tr)
			tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to)))
			return true
		})

	// every selected paragraph ends up in a list of this type
	const applyListType = (editor, listType) =>
		editor.commands.command(({ tr, state }) => {
			const { from, to } = state.selection
			const { listItem, [listType]: list } = state.schema.nodes

			state.doc.nodesBetween(from, to, (node, pos) => {
				if (!node.isTextblock) return
				const $paragraph = tr.doc.resolve(tr.mapping.map(pos))
				const end = tr.doc.resolve($paragraph.pos + node.nodeSize)

				if ($paragraph.parent.type == listItem) tr.setNodeMarkup($paragraph.before(-1), list)
				else tr.wrap($paragraph.blockRange(end), [{ type: list }, { type: listItem }])
			})

			joinNeighbouringLists(tr)
			return true
		})

	const joinNeighbouringLists = (tr) => {
		const joins = []
		tr.doc.descendants((node, pos, parent, index) => {
			const previous = index && parent.child(index - 1)
			if (listValues[node.type.name] && previous?.type == node.type) joins.push(pos)
		})
		// back to front, so a join never moves one still to come
		joins.reverse().forEach((pos) => tr.join(pos))
	}

	const setPropertyOn = (editor, property, value) => {
		const chain = editor.chain()

		if (property == 'list') return setListProperty(editor, value)

		const { empty } = editor.state.selection
		if (empty) selectStyleTarget(editor, chain)

		switch (property) {
			case 'textAlign':
				chain.setTextAlign(value).run()
				break
			case 'color':
				chain.setColor(value).run()
				break
			case 'lineHeight':
				editor.commands.setGlobalLineHeight(value)
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

	const updateProperty = (property, value) => {
		if (!isMultiSelection.value) return setPropertyOn(activeEditor.value, property, value)
		if (property === 'opacity') return setSelectedOpacity(value)
		formatSelectedText(property, value)
	}

	const showFirstEditableStyles = () => {
		const element = firstEditableElement.value
		if (hasTextContent(element)) setEditorStyles(loadScratchEditor(element))
	}

	const selectedTextTargets = () =>
		activeElements.value.filter((el) => !el.locked && hasTextContent(el))

	// one element run through the chain, with what the step before already knows about it
	const editContent = (element, runChain) => {
		const last = lastEdit(element)
		const editor = loadScratchEditor(element)
		runChain(editor)
		// a step that leaves the box as it is has nothing new to serialise or measure
		if (last && editor.state.doc.eq(last.doc)) {
			return { ...last, element, oldContent: last.newContent, oldWidth: last.newWidth }
		}
		const html = editor.getHTML()
		return {
			element,
			doc: editor.state.doc,
			oldContent: last ? element.content : patchedHTML(element.content),
			oldWidth: last?.newWidth,
			newContent: hasEmptyLine(editor.state.doc) ? patchedHTML(html) : html,
			anchor: growthAnchor(editor),
			left: element.left,
		}
	}

	// centred and right-aligned auto-width boxes pay their growth out of left, as when typing
	const shiftGrowingEdits = (edits) => {
		const growing = edits.filter(
			(edit) => edit.oldContent !== edit.newContent && canGrow(edit.element, edit.anchor),
		)
		const widths = measureHTMLList(
			growing.flatMap((e) => (e.oldWidth == null ? [e.oldContent, e.newContent] : [e.newContent])),
		).map((size) => size.elementWidth)

		growing.forEach((edit) => {
			edit.oldWidth ??= widths.shift()
			edit.newWidth = widths.shift()
			const delta = edit.newWidth - edit.oldWidth
			edit.left -= edit.anchor === 'center' ? delta / 2 : delta
		})
	}

	// three commands per element, so every batch of a burst has the shape coalescing folds
	const editCommands = ({ element, oldContent, newContent, left }) => {
		const command = (property, oldValue, newValue) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property,
				oldValue,
				newValue,
			})

		return [
			command('content', oldContent, newContent),
			command('left', element.left, left),
			command('editorMetadata', element.editorMetadata, undefined),
		]
	}

	const buildContentCommands = (targets, runChain) => {
		const edits = targets.map((element) => editContent(element, runChain))
		shiftGrowingEdits(edits)
		lastEdits = new Map(edits.map((edit) => [edit.element.id, edit]))
		return edits.flatMap(editCommands)
	}

	const runSelectedBatch = (key, commands) => {
		if (commands.every((c) => c.oldValue === c.newValue)) return

		const slideId = currentSlide.value.clientId
		const elementIds = activeElementIds.value
		commandHistory.execute(
			batchCommand({
				slideId,
				elementIds,
				commands,
				coalesceKey: `${key}:${slideId}:${elementIds.join()}`,
			}),
		)
	}

	const editSelectedText = (runChain) =>
		runSelectedBatch('content', buildContentCommands(selectedTextTargets(), runChain))

	// opacity is a text-style mark on a text box and an element property on everything else
	const setSelectedOpacity = throttleToFrame((value) => {
		const editable = activeElements.value.filter((el) => !el.locked)
		const textBoxes = editable.filter((el) => el.type === 'text')
		const others = editable.filter((el) => el.type !== 'text')

		const markOpacity = (editor) => setPropertyOn(editor, 'opacity', value)
		const opacityCommand = (element) =>
			editElementCommand({
				slideId: currentSlide.value.clientId,
				elementIds: [element.id],
				property: 'opacity',
				oldValue: element.opacity,
				newValue: value,
			})

		runSelectedBatch('opacity', [
			...buildContentCommands(textBoxes, markOpacity),
			...others.map(opacityCommand),
		])
	})

	const formatSelectedText = throttleToFrame((property, value) =>
		editSelectedText((editor) => setPropertyOn(editor, property, value)),
	)

	// tiptap's own rule, stretched across boxes: set unless every box is fully marked
	const toggleSelectedMark = (property) => {
		const marked = selectedTextTargets().every((element) => {
			const editor = loadScratchEditor(element)
			editor.commands.selectAll()
			return editor.isActive(property)
		})

		const command = marked ? 'unsetMark' : 'setMark'
		editSelectedText((editor) => editor.chain().selectAll()[command](property).run())
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
		formatSelectedText,
		showFirstEditableStyles,
		initTextEditor,
	}
}
