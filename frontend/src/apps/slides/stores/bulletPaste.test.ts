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

// drives the editor's real handlePaste chain the way a browser paste does
const pasteAs = (target: Editor, plain: string, html: string) => {
	const event = {
		clipboardData: {
			getData: (type: string) => (type === 'text/plain' ? plain : type === 'text/html' ? html : ''),
		},
		preventDefault: () => {},
	} as any
	let handled = false
	target.view.someProp('handlePaste', (f: any) => {
		if (handled) return
		if (f(target.view, event)) handled = true
	})
	// unclaimed pastes fall through to prosemirror's default rich paste
	if (!handled) target.view.pasteHTML(html, {} as any)
	return handled
}

const nodeNames = (target: Editor) => {
	const names: string[] = []
	target.state.doc.descendants((node) => {
		names.push(node.type.name)
	})
	return names
}

afterEach(() => {
	editor?.destroy()
	editor = null
})

describe('pasting copied bullet content', () => {
	const bullets =
		'<ul><li><p><span style="font-size: 28px; color: rgb(255, 0, 0)">first</span></p></li>' +
		'<li><p><span style="font-size: 28px; color: rgb(255, 0, 0)">second</span></p></li></ul>'

	it('keeps the bullet list structure', () => {
		const dest = mountEditor('<p>dest</p>')
		dest.commands.setTextSelection(dest.state.doc.content.size - 1)

		pasteAs(dest, 'first\nsecond', bullets)

		expect(nodeNames(dest)).toContain('bulletList')
		expect(nodeNames(dest)).toContain('listItem')
	})

	it('keeps the bullet text formatting', () => {
		const dest = mountEditor('<p>dest</p>')
		dest.commands.setTextSelection(dest.state.doc.content.size - 1)

		pasteAs(dest, 'first\nsecond', bullets)

		const html = dest.getHTML()
		expect(html).toContain('first')
		expect(html).toContain('font-size: 28px')
	})

	it('keeps ordered lists too', () => {
		const dest = mountEditor('<p></p>')
		dest.commands.setTextSelection(1)

		pasteAs(dest, '1. first', '<ol><li><p>first</p></li></ol>')

		expect(nodeNames(dest)).toContain('orderedList')
	})

	it('still pastes plain paragraphs as plain text with inherited styles', () => {
		const dest = mountEditor('<p>dest</p>')
		dest.commands.setTextSelection(dest.state.doc.content.size - 1)

		const handled = pasteAs(dest, 'plain words', '<p>plain words</p>')

		expect(handled).toBe(true)
		expect(nodeNames(dest)).not.toContain('bulletList')
		expect(dest.state.doc.textContent).toContain('plain words')
	})
})
