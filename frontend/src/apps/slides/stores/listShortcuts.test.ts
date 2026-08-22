import { describe, it, expect, afterEach, vi } from 'vitest'

import { Editor } from '@tiptap/vue-3'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { extensions } = await import('./tiptapSetup')

let editor: Editor | null = null

const mountEditor = (content: string) => {
	const element = document.createElement('div')
	document.body.appendChild(element)
	editor = new Editor({ element, extensions, content })
	return editor
}

const pressSpaceAfter = (editor: Editor, text: string) => {
	let contentStart = -1
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'paragraph' && node.textContent === text) contentStart = pos + 1
	})
	editor.commands.setTextSelection(contentStart + text.length)

	const view = editor.view
	view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
}

const ancestorNames = (editor: Editor) => {
	const $from = editor.state.selection.$from
	return Array.from({ length: $from.depth + 1 }, (_, d) => $from.node(d).type.name)
}

afterEach(() => {
	editor?.destroy()
	editor = null
})

describe('list shortcuts', () => {
	it('leaves the cursor in the new bullet item, not the next block', () => {
		const editor = mountEditor('<p>-</p><p>next</p>')

		pressSpaceAfter(editor, '-')

		expect(ancestorNames(editor)).toEqual(['doc', 'bulletList', 'listItem', 'paragraph'])
	})

	it('leaves the cursor in the new numbered item, not the next block', () => {
		const editor = mountEditor('<p>1.</p><p>next</p>')

		pressSpaceAfter(editor, '1.')

		expect(ancestorNames(editor)).toEqual(['doc', 'orderedList', 'listItem', 'paragraph'])
	})

	it('keeps the cursor inside the cell when a list starts in a table', () => {
		const editor = mountEditor(
			'<table><tbody><tr><td><p>-</p></td><td><p>b</p></td></tr></tbody></table>',
		)

		pressSpaceAfter(editor, '-')

		expect(ancestorNames(editor)).toEqual([
			'doc',
			'table',
			'tableRow',
			'tableCell',
			'bulletList',
			'listItem',
			'paragraph',
		])
	})
})

const paragraphsAfterList = (editor: Editor) => {
	const texts: string[] = []
	editor.state.doc.forEach((node) => {
		if (node.type.name === 'paragraph') texts.push(node.textContent.replace(/​/g, ''))
	})
	return texts
}

// splitting and then reporting the key as unhandled lets the default Enter split a
// second time, so one press dropped two lines and left the cursor past both
describe('enter in a paragraph that follows a list', () => {
	it('adds one blank line when the paragraph is empty', () => {
		const editor = mountEditor('<ul><li><p>one</p></li></ul><p></p>')
		editor.commands.setTextSelection(editor.state.doc.content.size - 1)

		editor.commands.keyboardShortcut('Enter')

		expect(paragraphsAfterList(editor)).toEqual(['', ''])
	})

	it('adds one blank line above when the cursor is at the start of the text', () => {
		const editor = mountEditor('<ul><li><p>one</p></li></ul><p>text</p>')
		let textStart = 0
		editor.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === 'text') textStart = pos
		})
		editor.commands.setTextSelection(textStart)

		editor.commands.keyboardShortcut('Enter')

		expect(paragraphsAfterList(editor)).toEqual(['', 'text'])
	})
})
