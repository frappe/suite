import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'

vi.mock('frappe-ui/experimental', () => ({
	ImageExtension: { extend: () => ({ configure: () => ({}) }) },
}))
vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}) }))

import { createEditorBody } from './editorBody'
import { CustomParagraphExtension } from './text-editor'
import { QuotedContentExtension } from './quotedContentExtension'

// The composer as wired: the body goes in as the editor's `content`, each change comes back out
// through `fromEditor`, and frappe-ui's TextEditor resets itself whenever `content` differs from
// what it holds.
const composer = (body: string) => {
	const editorBody = createEditorBody()
	const state = { body }
	const editor: Editor = new Editor({
		element: document.createElement('div'),
		extensions: [
			StarterKit.configure({ paragraph: false }),
			CustomParagraphExtension,
			QuotedContentExtension,
		],
		content: editorBody.toEditor(body),
		onUpdate: () => {
			state.body = editorBody.fromEditor(editor.getHTML())
			const content = editorBody.toEditor(state.body)
			if (editor.getHTML() !== content) editor.commands.setContent(content)
		},
	})
	return { editor, state }
}

const QUOTE =
	'<div class="frappe_mail_quote">On 9 Sep 2026, a@b.c wrote:' +
	'<blockquote><div>Can you ship on Friday?</div><div><br></div><div>Thanks</div></blockquote></div>'

describe('the composer body', () => {
	it('keeps a reply where it is typed, above an unfolded quote', () => {
		// Unfolded the way the composer's "···" does it: a <br>, then the quote.
		const { editor, state } = composer(`<div>Yes</div><br>${QUOTE}`)
		editor.commands.setTextSelection(4) // after "Yes"
		editor.commands.insertContent(',')
		editor.commands.insertContent(' on Friday.')
		expect(state.body).toContain(`<div>Yes, on Friday.</div><div><br></div>${QUOTE}`)
		editor.destroy()
	})

	it('takes a blank line in and gives it back as one blank line', () => {
		const { editor, state } = composer('<div>Hi</div><div><br></div><div>Bye</div>')
		editor.commands.setTextSelection(3)
		editor.commands.insertContent('!')
		expect(state.body).toBe('<div>Hi!</div><div><br></div><div>Bye</div>')
		editor.destroy()
	})
})
