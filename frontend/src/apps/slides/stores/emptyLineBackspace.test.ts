import { describe, it, expect, afterEach, vi } from 'vitest'

import { Editor } from '@tiptap/vue-3'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { extensions } = await import('./tiptapSetup')

const ZWSP = '​'

let editor: Editor | null = null

const mountEditor = (content: string) => {
	const element = document.createElement('div')
	document.body.appendChild(element)
	editor = new Editor({ element, extensions, content })

	let lastParagraph = -1
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === 'paragraph') lastParagraph = pos + 1
	})
	editor.commands.setTextSelection(lastParagraph)

	return editor
}

const backspace = (editor: Editor) => {
	const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true })
	editor.view.someProp('handleKeyDown', (f) => f(editor.view, event))
}

const blockNames = (editor: Editor) => {
	const names: string[] = []
	editor.state.doc.forEach((node) => names.push(node.type.name))
	return names
}

afterEach(() => {
	editor?.destroy()
	editor = null
})

const bullets = '<ul><li><p>first</p></li><li><p>second</p></li></ul>'

describe('backspace on an empty line', () => {
	it('takes one press per empty line, not two', () => {
		const editor = mountEditor(`${bullets}<p></p><p></p><p>${ZWSP}</p>`)

		backspace(editor)
		backspace(editor)
		backspace(editor)

		expect(blockNames(editor)).toEqual(['bulletList'])
		expect(editor.state.selection.$from.parent.textContent).toBe('second')
	})

	it('keeps the alignment when the whole document is selected', () => {
		const editor = mountEditor('<p style="text-align: center">one</p><p>two</p>')
		editor.commands.selectAll()

		backspace(editor)

		expect(editor.state.selection.$from.parent.attrs.textAlign).toBe('center')
		expect(editor.getHTML()).toContain('text-align: center')
	})

	it('still swaps in a placeholder when the whole line is selected', () => {
		const editor = mountEditor(`${bullets}<p>third</p>`)
		const { $from } = editor.state.selection
		editor.commands.setTextSelection({ from: $from.start(), to: $from.end() })

		backspace(editor)

		expect(editor.state.selection.$from.parent.textContent).toBe(ZWSP)
	})
})
