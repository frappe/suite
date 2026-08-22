import { describe, it, expect, afterEach, vi } from 'vitest'

import { Editor } from '@tiptap/vue-3'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { extensions, ZWSP } = await import('./tiptapSetup')

let editor: Editor | null = null

const mountEditor = (content: string) => {
	const element = document.createElement('div')
	document.body.appendChild(element)
	editor = new Editor({ element, extensions, content, parseOptions: { preserveWhitespace: true } })
	return editor
}

const pressTab = (editor: Editor, shift = false) =>
	editor.view.dom.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
	)

const lines = (editor: Editor) => {
	const texts: string[] = []
	editor.state.doc.descendants((node) => {
		if (node.isTextblock) texts.push(node.textContent)
	})
	return texts
}

const caretAt = (editor: Editor, text: string, offset: number) => {
	let start = -1
	editor.state.doc.descendants((node, pos) => {
		if (node.isTextblock && node.textContent === text) start = pos + 1
	})
	editor.commands.setTextSelection(start + offset)
}

afterEach(() => {
	editor?.destroy()
	editor = null
})

describe('indenting a line with tab', () => {
	it('writes the indent where the caret stands', () => {
		const editor = mountEditor('<p>return 1</p>')
		caretAt(editor, 'return 1', 0)

		pressTab(editor)

		expect(lines(editor)).toEqual(['\treturn 1'])
	})

	it('indents every line a selection reaches, from their starts', () => {
		const editor = mountEditor('<p>def foo():</p><p>return 1</p>')
		editor.commands.setTextSelection({ from: 3, to: 15 })

		pressTab(editor)

		expect(lines(editor)).toEqual(['\tdef foo():', '\treturn 1'])
	})

	it('takes the indent back off', () => {
		const editor = mountEditor('<p>\treturn 1</p>')
		caretAt(editor, '\treturn 1', 1)

		pressTab(editor, true)

		expect(lines(editor)).toEqual(['return 1'])
	})

	it('leaves a line that has no indent alone', () => {
		const editor = mountEditor('<p>return 1</p>')
		caretAt(editor, 'return 1', 0)

		pressTab(editor, true)

		expect(lines(editor)).toEqual(['return 1'])
	})

	it('indents a blank line without displacing its placeholder', () => {
		const editor = mountEditor(`<p><span style="font-size: 20px">${ZWSP}</span></p>`)
		caretAt(editor, ZWSP, 1)

		pressTab(editor)

		expect(lines(editor)).toEqual([`${ZWSP}\t`])
		expect(editor.getHTML()).toContain('font-size: 20px')
	})

	it('carries the line styles onto the indent it writes', () => {
		const editor = mountEditor('<p><span style="font-size: 20px">return 1</span></p>')
		caretAt(editor, 'return 1', 0)

		pressTab(editor)

		expect(editor.getHTML()).toContain('<span style="font-size: 20px;">\treturn 1</span>')
	})

	it('still nests a list item rather than indenting inside it', () => {
		const editor = mountEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
		caretAt(editor, 'two', 0)

		pressTab(editor)

		expect(lines(editor)).toEqual(['one', 'two'])
		expect(editor.state.selection.$from.node(-3).type.name).toBe('listItem')
	})

	it('leaves the item that cannot nest as it is', () => {
		const editor = mountEditor('<ul><li><p>one</p></li></ul>')
		caretAt(editor, 'one', 0)

		pressTab(editor)

		expect(lines(editor)).toEqual(['one'])
	})

	it('still moves between cells rather than indenting inside one', () => {
		const editor = mountEditor(
			'<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
		)
		caretAt(editor, 'a', 1)

		pressTab(editor)

		expect(lines(editor)).toEqual(['a', 'b'])
		expect(editor.state.selection.$from.parent.textContent).toBe('b')
	})
})
