import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import { TrailingNode } from '@tiptap/extensions'

// text-editor.ts also builds the image extension on frappe-ui's, which doesn't resolve under
// vitest; only its paragraph node (whose bare `div` rule this node has to beat) is wanted here.
vi.mock('frappe-ui/experimental', () => ({
	ImageExtension: { extend: () => ({ configure: () => ({}) }) },
}))
vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}) }))

import { CustomParagraphExtension } from './text-editor'
import { QuotedContentExtension } from './quotedContentExtension'

const roundTrip = (html: string) => {
	const editor = new Editor({
		extensions: [Document, Text, CustomParagraphExtension, QuotedContentExtension],
		content: html,
	})
	try {
		return editor.getHTML()
	} finally {
		editor.destroy()
	}
}

// A newsletter's table layout: everything the editor's own schema would throw away.
const NEWSLETTER =
	'<table width="600" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" align="center">' +
	'<tbody><tr><td width="300" style="padding:8px"><img src="https://x.test/logo.png" width="66" height="20"></td></tr></tbody>' +
	'</table>'

describe('QuotedContentExtension', () => {
	it('carries a reply quote through the editor untouched', () => {
		const quote =
			'<div class="frappe_mail_quote">On 9 Sep 2026 at 10:32 PM, a@b.c wrote:' +
			`<blockquote style="margin-left: 8px"><div class="frappe_mail_embed">${NEWSLETTER}</div></blockquote></div>`
		expect(roundTrip(`<div>Thanks.</div><br>${quote}`)).toContain(quote)
	})

	it('carries a forwarded message through the editor untouched', () => {
		const fwd = `<div class="frappe_mail_fwd"><br><br><div class="frappe_mail_embed">${NEWSLETTER}</div></div>`
		expect(roundTrip(`<div>FYI</div>${fwd}`)).toContain(fwd)
	})

	it('leaves the writer’s own markup to the schema', () => {
		expect(roundTrip('<div class="note">hello</div>')).toBe('<div>hello</div>')
	})

	// The composer's StarterKit pads the end of the body with a block the writer can type into,
	// on the first transaction — the focus the composer takes on opening. A click in the space
	// below the writing then puts the caret at the end of the body.
	describe('beside the trailing block', () => {
		const opened = (content: string) => {
			const editor = new Editor({
				extensions: [Document, Text, CustomParagraphExtension, QuotedContentExtension, TrailingNode],
				content,
			})
			editor.commands.focus()
			return editor
		}

		it('adds nothing to a body that ends in the writing', () => {
			const editor = opened('<div>Thanks,</div>')
			expect(editor.getHTML()).toBe('<div>Thanks,</div>')
			editor.destroy()
		})

		it('shows the caret at the end of the body', () => {
			const editor = opened('<div>Thanks,</div>')
			editor.commands.focus('end')
			expect(editor.state.selection.visible).toBe(true)
			editor.destroy()
		})

		it('leaves a line after a closing quote to write on', () => {
			const fwd = `<div class="frappe_mail_fwd"><br><br><div class="frappe_mail_embed">${NEWSLETTER}</div></div>`
			const editor = opened(`<div>FYI</div>${fwd}`)
			editor.commands.focus('end')
			editor.commands.insertContent('Thanks')
			expect(editor.getHTML()).toBe(`<div>FYI</div>${fwd}<div>Thanks</div>`)
			editor.destroy()
		})
	})
})
