import { ref, reactive, watch } from 'vue'
import { Editor } from '@tiptap/vue-3'
import { extensions, patchEmptyParagraphs } from '@/apps/slides/stores/tiptapSetup'
import { TextSelection } from 'prosemirror-state'
import { commandHistory } from '@/apps/slides/stores/historyMeta'
import { markDirty } from '@/apps/slides/stores/saving'
import {
	activeElement,
	clampWidthToSlide,
	findSlideElement,
	getInitialShapeTextContent,
} from '@/apps/slides/stores/element'
import { batchCommand, editElementCommand } from '@/apps/slides/stores/commands'
import { currentSlide } from '@/apps/slides/stores/slide'

export const activeEditor = ref(null)

// the element this editor was built for: activeElement flips a tick earlier
let editorElement = null
let editorSlideId = null
let lastCompositionId = null
let stopContentWatch = null

let suppressRecording = false

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
		withRecordingSuppressed(() => editor.commands.setContent(seed, { emitUpdate: false }))
		return
	}

	if (patchedHTML(editor.getHTML()) === html) return

	withRecordingSuppressed(() => editor.commands.setContent(html, { emitUpdate: false }))
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
		})
	}

	const updateElementContent = (editor) => {
		if (!editorElement) return
		editorElement.content = patchedHTML(editor.getHTML())
		markDirty()
	}

	const recordContentEdit = (oldValue, transaction, clampedWidth) => {
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

		if (!clampedWidth) return commandHistory.record(contentCommand, { forceCoalesce })

		// the clamp has to undo with the edit that triggered it
		const widthCommand = editElementCommand({
			slideId: editorSlideId,
			elementIds: [editorElement.id],
			property: 'width',
			oldValue: null,
			newValue: clampedWidth,
		})

		commandHistory.record(
			batchCommand({
				slideId: editorSlideId,
				elementIds: [editorElement.id],
				commands: [contentCommand, widthCommand],
			}),
		)
	}

	const handleOnTransaction = (editor, transaction) => {
		if (!transaction.docChanged) return

		// purposefully using onTransaction + docChanged instead of onUpdate
		// since onUpdate also triggers when activeEditor changes from one text box to another
		// leading to overwriting content for second one with first one's content

		// history and init pushes must leave no trace at all
		if (suppressRecording || !editorElement) return setEditorStyles(editor)

		const oldValue = patchedHTML(editorElement.content)

		updateElementContent(editor)
		const clampedWidth = clampWidthToSlide(editorElement)
		setEditorStyles(editor)

		recordContentEdit(oldValue, transaction, clampedWidth)
	}

	const markCommands = {
		bold: 'toggleBold',
		italic: 'toggleItalic',
		strike: 'toggleStrike',
		underline: 'toggleUnderline',
	}

	const toggleMark = (property) => {
		const currentEditor = activeEditor.value

		const chain = currentEditor.chain()

		const { empty } = currentEditor.state.selection
		if (empty) chain.selectAll()

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
		if (empty) chain.selectAll()

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

		stopContentWatch?.()
		stopContentWatch = watch(() => activeElement.value?.content, reconcileEditorContent)

		withRecordingSuppressed(() => {
			activeEditor.value = new Editor({
				extensions: extensions,
				editable: isEditable,
				content: content,
				// focus only lands once EditorContent has adopted the view, so tiptap
				// has to do it itself after mounting
				autofocus: isEditable ? 'all' : false,
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
