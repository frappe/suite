import { Editor } from '@tiptap/vue-3'
import { Extension } from '@tiptap/core'
import Paragraph from '@tiptap/extension-paragraph'

import { StarterKit } from '@tiptap/starter-kit'
import { TextStyle } from '@tiptap/extension-text-style'
import { TextAlign } from '@tiptap/extension-text-align'
import BulletList from '@tiptap/extension-bullet-list'
import OrderedList from '@tiptap/extension-ordered-list'
import ListItem from '@tiptap/extension-list-item'
import Color from '@tiptap/extension-color'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Selection } from '@tiptap/extensions'

import { Fragment, Slice } from 'prosemirror-model'
import { cellAround, CellSelection } from 'prosemirror-tables'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { joinBackward } from 'prosemirror-commands'
import { liftListItem } from 'prosemirror-schema-list'

import { getDocFromHTML } from '@/apps/slides/utils/helpers'
import { scaleAwareColumnResizing } from '@/apps/slides/utils/columnResizing'

const parseElementStyle = (attribute, value) => {
	if (!value) return null

	if (attribute == 'opacity') {
		const val = parseFloat(value)
		return isNaN(val) ? null : Math.round(val * 100)
	}

	return value
}

const renderAttributeHTML = (attribute, value) => {
	// every attribute renders, carried or not, and a style the span left out parses
	// back as null. Written out it reads as opacity: 0 and takes the text with it
	if (value == null) return {}

	const suffixes = {
		fontSize: 'px',
		letterSpacing: 'px',
	}

	const name = attribute.replace(/([A-Z])/g, '-$1').toLowerCase()

	if (attribute == 'opacity') {
		value = Number(value) / 100
		return { style: `${name}: ${value}` }
	}

	const suffix = suffixes[attribute] || ''
	const skipSuffix = typeof value == 'string' && value.includes(suffix)
	value = skipSuffix ? value : `${value}${suffix}`

	return value ? { style: `${name}: ${value}` } : {}
}

const CustomTextStyle = TextStyle.extend({
	addAttributes() {
		const attrs = {}

		const attributesList = [
			'fontSize',
			'textTransform',
			'fontFamily',
			'letterSpacing',
			'opacity',
		]

		attributesList.forEach((attr) => {
			attrs[attr] = {
				default: null,
				parseHTML: (element) => parseElementStyle(attr, element.style[attr]),
				renderHTML: (attributes) => renderAttributeHTML(attr, attributes[attr]),
			}
		})

		return attrs
	},
})

export const hasTableNode = (doc) => {
	for (let i = 0; i < doc.childCount; i++) {
		if (doc.child(i).type.name === 'table') return true
	}
	return false
}

export const getCells = (doc) => {
	const cells = []
	doc.descendants((node, pos) => {
		if (!['tableCell', 'tableHeader'].includes(node.type.name)) return
		cells.push({ pos, node })
		return false
	})
	return cells
}

const cellsToClear = ({ selection, doc }) => {
	if (selection instanceof CellSelection) return selection
	if (!hasTableNode(doc) || selection.from !== 0 || selection.to !== doc.content.size) return null

	const cells = getCells(doc)
	return cells.length ? CellSelection.create(doc, cells[0].pos, cells[cells.length - 1].pos) : null
}

export const getFirstMarks = (node) => {
	let marks = []
	node.descendants((child) => {
		if (!marks.length && child.isText) marks = child.marks
	})
	return marks
}

// marks need text to sit on, so a cleared cell keeps the placeholder and the marks
// the panel styles through
const emptiedCell = (cell, schema) => {
	const marks = getFirstMarks(cell)
	return schema.nodes.paragraph.create(cell.firstChild?.attrs, schema.text(ZWSP, marks))
}

// emptying a table clears its cells: taking the table node out would leave the
// element holding an empty paragraph
const clearSelectedCells = ({ editor }) => {
	const { state, dispatch } = editor.view
	const selection = cellsToClear(state)
	if (!selection) return false

	const cells = []
	selection.forEachCell((cell, pos) => cells.push({ cell, pos }))

	const { tr } = state
	tr.setSelection(selection)
	cells.reverse().forEach(({ cell, pos }) => {
		tr.replaceWith(pos + 1, pos + cell.nodeSize - 1, emptiedCell(cell, state.schema))
	})

	dispatch(tr)
	return true
}

const PastePlainText = Extension.create({
	name: 'pastePlainText',

	// a copied cell block carries text/plain too, so this has to yield to
	// tableEditing's handlePaste or pasting cells into a table flattens them
	priority: 90,

	addProseMirrorPlugins() {
		const pasteWithInheritedStyles = (view, event) => {
			const plainText = event.clipboardData?.getData('text/plain')
			if (!plainText) return false

			const { state, dispatch } = view
			const { tr } = state

			dispatch(tr.insertText(plainText, state.selection.from, state.selection.to))
			return true
		}

		// only table elements hold tables, and a text element left holding nothing but a
		// table reads as empty and gets deleted on blur. The cells hold the user's own
		// text though, so they come out as the lines they are rather than going with it
		const unwrapTables = (slice, view) => {
			if (hasTableNode(view.state.doc)) return slice

			const nodes = []
			let unwrapped = false

			slice.content.forEach((node) => {
				if (node.type.name !== 'table') {
					nodes.push(node)
					return
				}

				unwrapped = true
				node.descendants((child) => {
					if (!child.isTextblock) return true
					nodes.push(child)
					return false
				})
			})

			return unwrapped ? Slice.maxOpen(Fragment.fromArray(nodes)) : slice
		}

		const pastePlugin = new Plugin({
			props: { handlePaste: pasteWithInheritedStyles, transformPasted: unwrapTables },
		})

		return [pastePlugin]
	},
})

const getItemAttributes = (node) => {
	const paragraphNode = node.content?.firstChild
	const textNode = paragraphNode?.firstChild

	const attrs = {
		color: null,
		fontSize: null,
		fontFamily: null,
		letterSpacing: null,
		opacity: null,
	}

	if (textNode?.marks) {
		for (const mark of textNode.marks) {
			if (mark.type.name == 'textStyle') {
				// a copy: attrs belong to the live doc, and rewriting 28px to 28 there
				// leaves it unequal to its own parsed HTML
				const styleAttrs = { ...mark.attrs, fontSize: parseInt(mark.attrs.fontSize) }
				Object.assign(attrs, styleAttrs)
				return attrs
			}
		}
	}

	return attrs
}

const CustomListItem = ListItem.extend({
	addAttributes() {
		return {
			...this.parent?.(),

			lineHeight: {
				default: '1.5',
				parseHTML: (element) => element.style.lineHeight || '1.5',
			},
		}
	},

	// needed to ensure that <li> tag renders the span styles (e.g. font size, color etc.)
	// they need to be present at <li> level so that CSS ::before element can work for bullet styling
	renderHTML({ node, HTMLAttributes, ...rest }) {
		const liAttrs = { ...HTMLAttributes }

		const { color, fontSize, fontFamily, letterSpacing, opacity } = getItemAttributes(node)

		const styleAttrs = [liAttrs.style || '']

		if (color != null) styleAttrs.push(`color: ${color};`)
		if (fontSize != null) styleAttrs.push(`font-size: ${fontSize}px;`)
		if (fontFamily != null) styleAttrs.push(`font-family: ${fontFamily};`)
		if (letterSpacing != null) styleAttrs.push(`letter-spacing: ${letterSpacing};`)
		if (opacity != null) styleAttrs.push(`opacity: ${opacity};`)
		styleAttrs.push(`line-height: ${node.attrs.lineHeight || '1.5'};`)

		liAttrs.style = styleAttrs.join(' ')

		return ['li', liAttrs, 0]
	},
})

export const ZWSP = '\u200B'

const isInList = ($pos) => {
	// intentional since <li> is not direct parent of text node
	for (let d = $pos.depth; d > 0; d--) {
		const node = $pos.node(d)
		if (node.type.name === 'listItem') return true
	}
	return false
}

const isListItemEmpty = (pos) => {
	for (let d = pos.depth; d > 0; d--) {
		const node = pos.node(d)
		if (node.type.name === 'listItem') {
			let text = ''
			node.forEach((child) => {
				child.forEach((inline) => {
					text += inline.text || ''
				})
			})

			// li is empty if no text or only ZWSP characters
			return text.replace(/\u200B/g, '').trim() === ''
		}
	}
	return false
}

const handleListItemEnterKey = (editor, pos, marks) => {
	const { state, view } = editor

	const { from } = state.selection
	const endPos = pos.end()

	// if enter is pressed on an empty list item
	// lift the item out of the list instead of splitting
	if (isListItemEmpty(pos)) {
		liftListItem(state.schema.nodes.listItem)(state, view.dispatch)
		return true
	}

	if (from < endPos) {
		editor.commands.splitListItem('listItem')
		return true
	}

	// before splitting to next list item, insert ZWSP at end of current item
	// move cursor to end of current item and then split
	// so new list already has placeholder

	let tr = state.tr.replaceWith(endPos, endPos, state.schema.text(ZWSP, marks))
	tr = tr.setSelection(TextSelection.create(tr.doc, endPos))
	view.dispatch(tr)

	// intentional since if we split and then add placeholder
	// ProseMirror will not automatically re-trigger renderHTML for CustomListItem - line 122
	editor.commands.splitListItem('listItem')

	return true
}

const addEmptyLineBefore = (state, view, pos, marks) => {
	let tr = view.state.tr
	// the split moved the text down, so this lands in the blank line it left behind.
	// a ZWSP placeholder keeps <br class="ProseMirror-trailingBreak"> out of it
	tr.insert(pos.start(), state.schema.text(ZWSP, marks))
	tr = tr.setStoredMarks(marks)
	view.dispatch(tr)
	return true
}

const getCursorPositionFlags = (pos) => {
	const parent = pos.parent

	return {
		isCursorAtStart: pos.parentOffset === 0,
		isCursorAtEnd: pos.parentOffset === parent.content.size,
	}
}

const handleEnterKey = (editor) => {
	const { state, view } = editor
	const { selection, storedMarks } = state
	const $pos = selection.$from

	const marks = storedMarks || $pos.marks()

	if (isInList($pos)) {
		return handleListItemEnterKey(editor, $pos, marks)
	}

	const didSplit = editor.commands.splitBlock()

	// splitting to new line failed so don't change anything
	if (!didSplit) return false

	const { isCursorAtStart, isCursorAtEnd } = getCursorPositionFlags($pos)

	let tr = view.state.tr

	if (isCursorAtStart) {
		return addEmptyLineBefore(state, view, $pos, marks)
	} else if (isCursorAtEnd) {
		tr.insertText(ZWSP)
	}

	// re-apply marks to new span (created after split)
	tr = tr.setStoredMarks(marks)

	view.dispatch(tr)

	return true
}

function getFirstTextNodeInsideSelection(state) {
	const { from, to } = state.selection
	let foundText = null

	state.doc.nodesBetween(from, to, (node) => {
		if (node.isText) {
			foundText = node
			return false
		}
	})

	return foundText
}

const getMarksForPlaceholder = (state) => {
	let marks = state.storedMarks || state.selection.$from.marks()

	if (!marks || marks.length === 0) {
		const firstText = getFirstTextNodeInsideSelection(state)
		marks = firstText ? firstText.marks : []
	}

	return marks
}

const getFirstTextblockAttrs = (doc) => {
	let attrs = null
	doc.descendants((node) => {
		if (!attrs && node.isTextblock) attrs = node.attrs
		return !attrs
	})
	return attrs
}

const addPlaceholderAndRetainMarks = (event, view, start, end) => {
	event.preventDefault()

	const state = view.state
	const marks = getMarksForPlaceholder(state)
	// a doc-wide replace rebuilds the paragraph bare, dropping alignment and line height
	const blockAttrs = state.doc.resolve(start).depth ? null : getFirstTextblockAttrs(state.doc)

	let tr = state.tr
	tr = tr.replaceWith(start, end, state.schema.text(ZWSP, marks))
	if (blockAttrs) tr = tr.setNodeMarkup(start, undefined, blockAttrs)
	tr = tr.setStoredMarks(marks)
	tr = tr.setSelection(TextSelection.create(tr.doc, start + 1))
	view.dispatch(tr)

	return true
}

const removePlaceholderAndJoinBackward = (event, view, start, end) => {
	event.preventDefault()

	let tr = view.state.tr.delete(start, end).setMeta('addToHistory', false)
	view.dispatch(tr)

	joinBackward(view.state, view.dispatch)

	return true
}

const getSelectionRange = (selection) => {
	const $from = selection.$from
	const $to = selection.$to

	return {
		from: $from.pos,
		to: $to.pos,
		start: $from.start(),
		end: $from.end(),
	}
}

const getTextForSelection = ($from) => {
	return $from.parent.textContent || ''
}

const getPrevNode = ($from, view) => {
	const blockDepth = $from.depth
	const posBeforeBlock = $from.before(blockDepth)

	const resolved = view.state.doc.resolve(posBeforeBlock)
	return resolved.nodeBefore
}

const joinBackwardAfterPlaceholder = (view) => {
	joinBackward(view.state, view.dispatch)

	let tr = view.state.tr
	const newPos = view.state.selection.$from.pos
	tr = tr.delete(newPos - 1, newPos)
	view.dispatch(tr)

	return true
}

const joinIntoPrevList = (event, view, $from) => {
	event.preventDefault()

	const { state } = view
	const posBeforeBlock = $from.before($from.depth)
	const posAfterBlock = $from.after($from.depth)

	// delete the entire empty paragraph
	let tr = state.tr.delete(posBeforeBlock, posAfterBlock)

	// place cursor at the end of the last list item
	const resolvedPos = tr.doc.resolve(posBeforeBlock - 1)
	tr = tr.setSelection(TextSelection.near(resolvedPos, -1))

	view.dispatch(tr)
	return true
}

const createListItemWithMarks = (event, view, listType) => {
	const { selection, schema } = view.state
	const $from = selection.$from

	const marks = $from.parent.content.firstChild?.marks ?? []

	event.preventDefault()

	const { start, end } = getSelectionRange(selection)

	const zwsp = schema.text(ZWSP, marks)
	const listItemPara = schema.nodes.paragraph.create($from.parent.attrs, zwsp)
	const listItem = schema.nodes.listItem.create(null, listItemPara)

	const nodeType = listType === 'unordered' ? schema.nodes.bulletList : schema.nodes.orderedList
	const listNode = nodeType.create(null, listItem)

	const tr = view.state.tr.replaceWith(start - 1, end, listNode)

	// end of the placeholder; off by one and near() walks forward out of the cell
	const resolvedPos = tr.doc.resolve(start + listNode.nodeSize - 4)
	tr.setSelection(TextSelection.near(resolvedPos))

	view.dispatch(tr)
	return true
}

const handleSpaceKey = (event, view) => {
	const { selection } = view.state
	const $from = selection.$from

	if (isInList($from)) return

	const text = getTextForSelection($from)

	// Bullet list: "- " or ZWSP + "- "
	if (text === '-' || text === `${ZWSP}-`) {
		return createListItemWithMarks(event, view, 'unordered')
	}

	// Ordered list: "1. " or ZWSP + "1."
	if (/^1\.$/.test(text) || new RegExp(`^${ZWSP}1\\.$`).test(text)) {
		return createListItemWithMarks(event, view, 'ordered')
	}
}

const handleBackspaceInListItem = (event, view, $from) => {
	const { selection } = view.state
	const { from, to, start, end } = getSelectionRange(selection)
	const text = getTextForSelection($from)

	const lastCharOnLine = text.length === 1 && text !== ZWSP
	const isEntireParagraphSelected = start !== end && from === start && to === end

	// last real character or full selection - replace with ZWSP placeholder
	if (lastCharOnLine || isEntireParagraphSelected) {
		return addPlaceholderAndRetainMarks(event, view, start, end)
	}

	// only ZWSP - lift list item into paragraph and retain ZWSP
	if (text === ZWSP) {
		event.preventDefault()
		liftListItem(view.state.schema.nodes.listItem)(view.state, view.dispatch)
		return true
	}

	return false
}

const handleKeyDown = (view, event) => {
	if (event.key === ' ') return handleSpaceKey(event, view)

	if (event.key !== 'Backspace') return false

	const { selection, doc } = view.state
	const $from = selection.$from

	// the table keymap empties cells instead of swapping the table for a placeholder
	const spansWholeDoc = selection.from === 0 && selection.to === doc.content.size
	if (selection instanceof CellSelection || (hasTableNode(doc) && spansWholeDoc)) return false

	if (isInList($from)) return handleBackspaceInListItem(event, view, $from)

	const text = getTextForSelection($from)
	if (text === undefined) return false

	const { from, to, start, end } = getSelectionRange(selection)

	// an empty paragraph has start === end, so the equality alone reads as a full
	// selection and swaps a placeholder in instead of joining backward
	const lastCharOnLine = text.length === 1 && text !== ZWSP
	const isEntireParagraphSelected = start !== end && from === start && to === end
	const isFullDocSelected = from === 0 && to === view.state.doc.content.size

	if (lastCharOnLine || isEntireParagraphSelected || isFullDocSelected) {
		// if the last non-ZWSP character is being deleted, replace with ZWSP + re-apply marks
		// so <br class="ProseMirror-trailingBreak"> is not added
		return addPlaceholderAndRetainMarks(event, view, start, end)
	}

	const prevNode = getPrevNode($from, view)

	if (text === ZWSP && prevNode && prevNode.isTextblock) {
		// if only ZWSP is present, default behavior will lead to
		// deleting it and adding <br class="ProseMirror-trailingBreak">
		// so manually delete ZWSP and join with previous line which is expected behavior without the placeholder
		return removePlaceholderAndJoinBackward(event, view, start, end)
	}

	if (
		text === ZWSP &&
		prevNode &&
		(prevNode.type.name === 'bulletList' || prevNode.type.name === 'orderedList')
	) {
		// paragraph is after a list - delete the empty paragraph and move cursor to last list item
		return joinIntoPrevList(event, view, $from)
	}

	if (text === ZWSP) {
		// if only ZWSP is present but no previous textblock, do nothing
		event.preventDefault()
		return true
	}

	if (prevNode && prevNode.isTextblock && prevNode.textContent === ZWSP) {
		return joinBackwardAfterPlaceholder(view)
	}

	return false
}

const handleTextInput = (view, from, to, text) => {
	const { state } = view

	const $pos = state.selection.$from
	const { selection } = state
	const { start, end } = getSelectionRange(selection)

	const lineText = getTextForSelection($pos)
	const isEmptyLine = lineText.replace(/\u200B/g, '') === ''
	const isEntireParagraphSelected = from === start && to === end

	if (!isEmptyLine && !isEntireParagraphSelected) return false

	const marks = getMarksForPlaceholder(state)

	let tr = state.tr
	tr = tr.replaceWith(start, end, state.schema.text(text, marks))
	tr = tr.setStoredMarks(marks)

	const cursorPos = tr.mapping.map(end)
	tr = tr.setSelection(TextSelection.near(tr.doc.resolve(cursorPos)))

	view.dispatch(tr)

	return true
}

const getNearestTextMarks = ($from) => {
	let start = 0
	let end = $from.doc.content.size

	for (let depth = $from.depth; depth > 0; depth--) {
		// a table cell is isolating, and its own styling context
		if ($from.node(depth).type.spec.isolating) {
			start = $from.start(depth)
			end = $from.end(depth)
			break
		}
	}

	let before = null
	let after = null

	$from.doc.nodesBetween(start, end, (node, pos) => {
		if (!node.isText) return
		if (pos < $from.pos) before = node.marks
		else after = after || node.marks
	})

	return before || after || []
}

// a blank line holds no marks of its own, so the properties panel reads null and
// the next keystroke lands unstyled - carry the nearest text's styles over
const inheritMarksOnBlankLine = (state) => {
	const { selection, storedMarks } = state
	if (storedMarks || !selection.empty || selection.$from.parent.content.size) return null

	const marks = getNearestTextMarks(selection.$from)

	return marks.length ? state.tr.setStoredMarks(marks) : null
}

const styleForMarks = (marks) =>
	marks
		.map((mark) => mark.type.spec.toDOM?.(mark, true)?.[1]?.style)
		.filter(Boolean)
		.join('; ')

// an empty line renders as a bare <br>, so it takes the app's font size and color
// instead of the text's and the caret shows up tiny, or invisible on a dark slide.
// this has to paint exactly what patchEmptyParagraphs writes on save, or the line
// changes height the moment the element is deselected
const blankLineDecorations = (state) => {
	const decorations = []
	let prevStyle = null

	state.doc.descendants((node, pos) => {
		if (node.type.spec.isolating) return false
		if (node.type.name !== 'paragraph') return

		if (node.content.size) {
			prevStyle = styleForMarks(node.firstChild?.marks ?? []) || prevStyle
		} else if (prevStyle) {
			decorations.push(Decoration.node(pos, pos + node.nodeSize, { style: prevStyle }))
		}

		return false
	})

	return DecorationSet.create(state.doc, decorations)
}

const styledEmptyLinePlugin = new Plugin({
	key: new PluginKey('styledEmptyLinePlugin'),
	props: {
		// before adding an unstyled empty line on clearing content
		// add a ZWSP with stored marks to retain styles
		handleKeyDown,
		// before typing new text to styled empty line
		// remove the placeholder ZWSP
		handleTextInput,
		decorations: blankLineDecorations,
	},
	appendTransaction: (transactions, oldState, newState) => inheritMarksOnBlankLine(newState),
})

const StyledEmptyLine = Extension.create({
	name: 'StyledEmptyLine',

	addKeyboardShortcuts() {
		return {
			// insert ZWSP char so ProseMirror does not add <br class="ProseMirror-trailingBreak">
			// instead adds an empty styled span - so line height, font size etc. are consistent
			Enter: ({ editor }) => handleEnterKey(editor),
		}
	},

	addProseMirrorPlugins() {
		return [styledEmptyLinePlugin]
	},
})

const INDENT = '\t'

// nodesBetween reaches a block the selection only touches the edge of, which is
// one the user never selected any of
const getSelectedTextblocks = (state) => {
	const { from, to, empty } = state.selection
	const blocks = []

	state.doc.nodesBetween(from, to, (node, pos) => {
		if (!node.isTextblock) return

		const start = pos + 1
		if (empty || (start < to && start + node.content.size > from)) blocks.push({ node, pos })
	})

	return blocks
}

// the indent goes after a blank line's placeholder, which holds its styles
const readLineStart = (node, pos) => {
	const heldByPlaceholder = node.textContent.startsWith(ZWSP)

	return {
		pos: pos + 1 + (heldByPlaceholder ? 1 : 0),
		text: heldByPlaceholder ? node.textContent.slice(1) : node.textContent,
	}
}

const addIndent = ({ editor }) => {
	const { state, dispatch } = editor.view
	// a list item nests instead, and the one that cannot nest keeps its place
	if (isInList(state.selection.$from)) return true

	const { tr, selection, schema } = state
	const blocks = getSelectedTextblocks(state)

	if (blocks.length < 2) {
		tr.replaceWith(selection.from, selection.to, schema.text(INDENT, getMarksForPlaceholder(state)))
	} else {
		blocks.reverse().forEach(({ node, pos }) => {
			tr.insert(readLineStart(node, pos).pos, schema.text(INDENT, getFirstMarks(node)))
		})
	}

	dispatch(tr)
	return true
}

const removeIndent = ({ editor }) => {
	const { state, dispatch } = editor.view
	if (isInList(state.selection.$from)) return true

	const { tr } = state
	let outdented = false

	getSelectedTextblocks(state)
		.reverse()
		.forEach(({ node, pos }) => {
			const line = readLineStart(node, pos)
			if (!line.text.startsWith(INDENT)) return

			tr.delete(line.pos, line.pos + 1)
			outdented = true
		})

	if (outdented) dispatch(tr)

	// swallow the key even when there was nothing to outdent, else focus leaves the element
	return true
}

// runs last of the tab bindings, so tables and lists keep theirs
const LineIndent = Extension.create({
	name: 'lineIndent',
	priority: 50,

	addKeyboardShortcuts() {
		return {
			Tab: addIndent,
			'Shift-Tab': removeIndent,
		}
	},
})

const updateParagraphHTML = (doc, p, prevSpanStyles) => {
	p.innerHTML = ''

	const span = doc.createElement('span')
	span.setAttribute('style', prevSpanStyles)
	span.innerHTML = ZWSP

	p.appendChild(span)
}

export const patchEmptyParagraphs = (htmlString) => {
	// to patch <br class="ProseMirror-trailingBreak"> -> ZWSP
	// before StyledEmptyLine plugin was added
	let didUpdate = false

	const doc = getDocFromHTML(htmlString)

	const allParagraphs = Array.from(doc.body.querySelectorAll('p'))
	let prevSpanStyles = null

	allParagraphs.forEach((p) => {
		// each table cell is its own styling context, styles must not carry across cells
		if (p.closest('td, th')) return

		const isEmpty = p.textContent.trim() === ''
		const firstSpan = p.querySelector('span')

		if (!isEmpty && firstSpan) {
			prevSpanStyles = firstSpan.getAttribute('style') || ''
			return
		}

		if (isEmpty && prevSpanStyles) {
			if (!didUpdate) didUpdate = true

			updateParagraphHTML(doc, p, prevSpanStyles)
		}
	})

	return {
		wasUpdated: didUpdate,
		updatedHTML: didUpdate ? doc.body.innerHTML : htmlString,
	}
}

const CustomParagraph = Paragraph.extend({
	addAttributes() {
		return {
			...this.parent?.(),
			textAlign: {
				default: null,
				parseHTML: (element) => {
					const val = element.style.textAlign
					return ['left', 'center', 'right', 'justify'].includes(val) ? val : null
				},
				renderHTML: (attributes) =>
					attributes.textAlign ? { style: `text-align: ${attributes.textAlign}` } : {},
			},
			lineHeight: {
				default: '1.5',

				parseHTML: (element) => {
					return element.style.lineHeight || '1.5'
				},
				renderHTML: (attributes) =>
					attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
			},
		}
	},
})

const LineHeight = Extension.create({
	name: 'lineHeight',

	addCommands() {
		return {
			setGlobalLineHeight:
				(lineHeight) =>
				({ tr, state, dispatch }) => {
					state.doc.descendants((node, pos) => {
						if (
							node.type === state.schema.nodes.paragraph ||
							node.type === state.schema.nodes.listItem
						) {
							tr.setNodeMarkup(pos, undefined, {
								...node.attrs,
								lineHeight,
							})
						}
					})

					tr.setMeta('addToHistory', true)

					if (dispatch) dispatch(tr)
					return true
				},
		}
	},
})

// any CSS color, not the palette names frappe-ui's cell extensions gate on, so a theme
// token can be stored through the same attribute later
const cellAttributes = {
	backgroundColor: {
		default: null,
		parseHTML: (element) => element.style.backgroundColor || null,
		renderHTML: ({ backgroundColor }) =>
			backgroundColor ? { style: `background-color: ${backgroundColor}` } : {},
	},
}

const withCellAttributes = (extension) =>
	extension.extend({
		addAttributes() {
			return { ...this.parent?.(), ...cellAttributes }
		},
		// the static render lays a cell out by the browser's table rules, which
		// collapse whitespace the editor would otherwise keep
		parseHTML() {
			return (this.parent?.() || []).map((rule) => ({ ...rule, preserveWhitespace: false }))
		},
	})

const getCellAlign = (doc) => {
	let align = null
	doc.descendants((node) => {
		if (!align && node.type.name === 'paragraph') align = node.attrs.textAlign
	})
	return align
}

// prosemirror builds a new cell bare: no width of its own, which would leave the table
// unable to state how wide it is, no text for the panel's marks to sit on, and no
// alignment, which a header cell then reads as the browser's centred default
export const seedNewCells = ({ tr }) => {
	const cells = getCells(tr.doc)
	const width = cells[0]?.node.attrs.colwidth?.[0]
	const marks = getFirstMarks(tr.doc)
	const align = getCellAlign(tr.doc)

	cells.reverse().forEach(({ pos, node }) => {
		if (!node.textContent) tr.insert(pos + 2, tr.doc.type.schema.text(ZWSP, marks))
		if (width && !node.attrs.colwidth) tr.setNodeAttribute(pos, 'colwidth', [width])
		if (align && !node.firstChild?.attrs.textAlign) tr.setNodeAttribute(pos + 1, 'textAlign', align)
	})
	return true
}

const getWidthPerColumn = (table) => {
	const widths = []
	table.forEach((row) =>
		row.forEach((cell, _offset, index) => {
			if (!widths[index] && cell.attrs.colwidth) widths[index] = cell.attrs.colwidth[0]
		}),
	)
	return widths
}

const hasBareCell = (doc) => {
	let bare = false
	doc.descendants((node) => {
		if (['tableCell', 'tableHeader'].includes(node.type.name) && !node.attrs.colwidth) bare = true
	})
	return bare
}

// a paste grows the table with bare cells, and one width-less column stops the table
// stating how wide it is, which is what the element frame follows
const ColumnWidths = Extension.create({
	name: 'columnWidths',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				appendTransaction: (transactions, oldState, state) => {
					if (!transactions.some((transaction) => transaction.docChanged)) return null
					// a table that stated no widths lays itself out inside its frame, and a
					// drag on one of its columns must not hand that width to all the others
					if (hasBareCell(oldState.doc)) return null

					const { tr } = state
					let seeded = false

					state.doc.descendants((table, tablePos) => {
						if (table.type.name !== 'table') return
						const widths = getWidthPerColumn(table)
						const fallback = widths.find(Boolean)
						if (!fallback) return false

						table.forEach((row, rowOffset) => {
							row.forEach((cell, cellOffset, index) => {
								if (cell.attrs.colwidth) return

								tr.setNodeAttribute(
									tablePos + 2 + rowOffset + cellOffset,
									'colwidth',
									Array(cell.attrs.colspan).fill(widths[index] || fallback),
								)
								seeded = true
							})
						})

						return false
					})

					return seeded ? tr : null
				},
			}),
		]
	},
})

// Tab selects the content of the cell it lands in, and an untouched cell holds only
// the placeholder: a selection one zero-width character wide shows nothing at all
const EmptyCellCaret = Extension.create({
	name: 'emptyCellCaret',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				appendTransaction: (_transactions, _oldState, state) => {
					const { selection, doc } = state
					if (selection.empty || !(selection instanceof TextSelection)) return null
					if (!cellAround(selection.$from)) return null
					// a range the user drew across lines is theirs, however little text it holds
					if (!selection.$from.sameParent(selection.$to)) return null
					if (doc.textBetween(selection.from, selection.to) !== ZWSP) return null

					return state.tr.setSelection(TextSelection.create(doc, selection.to))
				},
			}),
		]
	},
})

const ScaledColumnResizing = Extension.create({
	name: 'scaledColumnResizing',

	// resize drags have to be seen before tableEditing turns them into cell
	// selections. Array position decides that today only by way of tiptap
	// reversing the list, which a reorder would silently undo
	priority: 200,

	addProseMirrorPlugins() {
		// mirrors what tiptap's own resizable wiring passes, so a column with no
		// width of its own can shrink as far in the editor as it does once saved
		return [scaleAwareColumnResizing({ cellMinWidth: 25, defaultCellMinWidth: 25 })]
	},
})

export const extensions = [
	StarterKit.configure({
		// the app's command history owns undo now
		undoRedo: false,
		paragraph: false,
		bulletList: false,
		orderedList: false,
		listItem: false,
		trailingNode: false,
	}),
	CustomParagraph,
	CustomListItem,
	CustomTextStyle,
	Color,
	TextAlign.configure({
		types: ['paragraph'],
	}),
	PastePlainText,
	BulletList.configure({
		keepAttributes: true,
		keepMarks: true,
	}),
	OrderedList.configure({
		keepAttributes: true,
		keepMarks: true,
	}),
	StyledEmptyLine,
	LineIndent,
	LineHeight,
	Selection.configure({ className: 'persisted-selection' }),
	// resizing is app-level: prosemirror's column resizing math ignores canvas scale
	Table.extend({
		// stock deletes the table once every cell is selected, leaving the element
		// holding an empty paragraph
		addKeyboardShortcuts() {
			return {
				...this.parent?.(),
				Backspace: clearSelectedCells,
				'Mod-Backspace': clearSelectedCells,
				Delete: clearSelectedCells,
				'Mod-Delete': clearSelectedCells,
				// stock adds the row bare, so a row tabbed into existence has none of
				// what the panel and the context menu seed theirs with
				Tab: () => {
					if (this.editor.commands.goToNextCell()) return true
					if (!this.editor.can().addRowAfter()) return false
					return this.editor
						.chain()
						.addRowAfter()
						.command(seedNewCells)
						.goToNextCell()
						.run()
				},
			}
		},
	}).configure({ resizable: false, View: null }),
	TableRow,
	withCellAttributes(TableCell),
	withCellAttributes(TableHeader),
	ScaledColumnResizing,
	EmptyCellCaret,
	ColumnWidths,
]
