import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/vue-3'
import { Fragment, Slice } from 'prosemirror-model'

vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

const { extensions, ZWSP } = await import('./tiptapSetup')

let editor: Editor | null = null

const mountEditor = (content: string) => {
	const element = document.createElement('div')
	document.body.appendChild(element)
	editor = new Editor({ element, extensions, content })
	return editor
}

const paste = (target: Editor, plain: string) => {
	const event = {
		clipboardData: { getData: (type: string) => (type === 'text/plain' ? plain : '') },
		preventDefault: () => {},
	} as any
	const slice = new Slice(Fragment.from(target.schema.text(plain)), 0, 0)
	target.view.someProp('handlePaste', (f: any) => f(target.view, event, slice))
}

const caretAfter = (target: Editor, text: string) => {
	let pos = -1
	target.state.doc.descendants((node, nodePos) => {
		if (node.isText && node.text?.includes(text)) pos = nodePos + node.text.indexOf(text) + text.length
	})
	target.commands.setTextSelection(pos)
}

const textblocks = (target: Editor) => {
	const lines: string[] = []
	target.state.doc.descendants((node) => {
		if (node.isTextblock) lines.push(node.textContent)
	})
	return lines
}

afterEach(() => {
	editor?.destroy()
	editor = null
})

describe('pasting plain text with line breaks', () => {
	it('gives every line its own paragraph', () => {
		const editor = mountEditor('<p>x</p>')
		caretAfter(editor, 'x')

		paste(editor, 'a\nb\nc')

		expect(textblocks(editor)).toEqual(['xa', 'b', 'c'])
		expect(editor.state.doc.childCount).toBe(3)
	})

	it('reads windows line endings the same way', () => {
		const editor = mountEditor('<p>x</p>')
		caretAfter(editor, 'x')

		paste(editor, 'a\r\nb')

		expect(textblocks(editor)).toEqual(['xa', 'b'])
	})

	it('keeps the rest of the line after the caret at the end of the paste', () => {
		const editor = mountEditor('<p>onetwo</p>')
		caretAfter(editor, 'one')

		paste(editor, 'a\nb')
		editor.commands.insertContent('!')

		expect(textblocks(editor)).toEqual(['onea', 'b!two'])
	})

	it('carries the text styles and alignment onto every line', () => {
		const editor = mountEditor(
			'<p style="text-align: center"><span style="font-size: 24px">x</span></p>',
		)
		caretAfter(editor, 'x')

		paste(editor, 'a\nb\nc')

		const paragraphs = Array.from(editor.view.dom.querySelectorAll('p'))
		expect(paragraphs).toHaveLength(3)
		paragraphs.forEach((p) => {
			expect(p.style.textAlign).toBe('center')
			expect(p.querySelector('span')?.style.fontSize).toBe('24px')
		})
	})

	it('makes a list item of every line inside a list', () => {
		const editor = mountEditor('<ol><li><p>x</p></li></ol>')
		caretAfter(editor, 'x')

		paste(editor, 'a\nb\nc')

		expect(textblocks(editor)).toEqual(['xa', 'b', 'c'])
		expect(editor.state.doc.childCount).toBe(1)
		expect(editor.state.doc.firstChild?.childCount).toBe(3)
	})

	it('gives every line the styles of the text it replaces', () => {
		const editor = mountEditor(
			'<p><span style="color: red">red</span><span style="color: blue">blue</span></p>',
		)
		const start = editor.state.doc.firstChild!.content.size - 'blue'.length + 1
		editor.commands.setTextSelection({ from: start, to: start + 'blue'.length })

		paste(editor, 'a\nb')

		const spans = Array.from(editor.view.dom.querySelectorAll('span'))
		expect(spans.map((span) => [span.textContent, span.style.color])).toEqual([
			['red', 'red'],
			['a', 'blue'],
			['b', 'blue'],
		])
	})

	it('replaces the whole text when everything is selected', () => {
		const editor = mountEditor('<p>hello</p><p>world</p>')
		editor.commands.selectAll()

		paste(editor, 'a\nb')
		editor.commands.insertContent('!')

		expect(textblocks(editor)).toEqual(['a', 'b!'])
	})

	it('replaces whole selected list items with a leading line break', () => {
		const editor = mountEditor('<p>q</p><ol><li><p>cd</p></li><li><p>ef</p></li></ol>')
		let from = -1
		let to = -1
		editor.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === 'cd') from = pos
			if (node.isText && node.text === 'ef') to = pos + 2
		})
		editor.commands.setTextSelection({ from, to })

		paste(editor, '\nb')

		expect(textblocks(editor)).toEqual(['q', ZWSP, 'b'])
	})

	it('keeps a blank line blank but styled', () => {
		const editor = mountEditor('<p><span style="font-size: 24px">x</span></p>')
		caretAfter(editor, 'x')

		paste(editor, 'a\n\nb')

		expect(textblocks(editor)).toEqual(['xa', ZWSP, 'b'])
		const blank = editor.view.dom.querySelectorAll('p')[1]
		expect(blank.querySelector('span')?.style.fontSize).toBe('24px')
	})
})
