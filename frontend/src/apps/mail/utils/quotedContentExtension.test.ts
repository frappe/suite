import { describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import { TrailingNode, UndoRedo } from '@tiptap/extensions'

// text-editor.ts also builds the image extension on frappe-ui's, which doesn't resolve under
// vitest; only its paragraph node (whose bare `div` rule this node has to beat) is wanted here.
vi.mock('frappe-ui/experimental', () => ({
	ImageExtension: { extend: () => ({ configure: () => ({}) }) },
}))
vi.mock('frappe-ui', () => ({ useFileUpload: () => ({}) }))

import { CustomParagraphExtension } from './text-editor'
import { QuotedContentExtension } from './quotedContentExtension'
import { findQuoteRoots } from './quotedContent'

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

	// The writer edits the quote where it stands, as the mail it is: the composer's "···" unfolds it,
	// and what they change is what leaves.
	describe('edited in the composer', () => {
		const QUOTE =
			'<div class="frappe_mail_quote">On 9 Sep 2026, a@b.c wrote:' +
			'<blockquote><div>Can you ship on Friday?</div><div>And the invoice?</div></blockquote></div>'

		// In the document, where a selection can be put.
		const mounted = (content: string) =>
			new Editor({
				element: document.body.appendChild(document.createElement('div')),
				extensions: [Document, Text, CustomParagraphExtension, QuotedContentExtension, UndoRedo],
				content,
			})
		const quoteIn = (editor: Editor) =>
			editor.view.dom.querySelector<HTMLElement>('.frappe_mail_quote')!
		const type = (quote: HTMLElement, edit: () => void) => {
			edit()
			quote.dispatchEvent(new Event('input', { bubbles: true }))
		}
		const pressEnter = (quote: HTMLElement) =>
			quote.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
			)
		const readerSees = (html: string) => {
			const doc = new DOMParser().parseFromString(html, 'text/html')
			findQuoteRoots(doc).forEach((trail) => trail.remove())
			return doc.body.textContent!.replace(/\s+/g, ' ').trim()
		}

		it('can be typed into', () => {
			const editor = mounted(`<div>Thanks.</div>${QUOTE}`)
			expect(quoteIn(editor).getAttribute('contenteditable')).toBe('true')
			editor.destroy()
		})

		it('leaves as the writer edited it, the rest of its markup untouched', () => {
			const quote =
				'<div class="frappe_mail_quote">On 9 Sep 2026, a@b.c wrote:' +
				`<blockquote><div>Draft attached.</div>${NEWSLETTER}</blockquote></div>`
			const editor = mounted(`<div>Thanks.</div>${quote}`)
			const el = quoteIn(editor)
			type(el, () => (el.querySelector('blockquote div')!.textContent = 'Final attached.'))
			expect(editor.getHTML()).toBe(
				`<div>Thanks.</div>${quote.replace('Draft attached.', 'Final attached.')}`,
			)
			editor.destroy()
		})

		it('comes back as it was on undo', () => {
			const editor = mounted(`<div>Thanks.</div>${QUOTE}`)
			const el = quoteIn(editor)
			type(el, () => el.querySelector('blockquote div')!.remove())
			editor.commands.undo()
			expect(editor.getHTML()).toBe(`<div>Thanks.</div>${QUOTE}`)
			expect(quoteIn(editor).textContent).toContain('Can you ship on Friday?')
			editor.destroy()
		})

		it('answers between the quoted lines on Enter, and the reader shows the answer', () => {
			const editor = mounted(`<div>See below.</div>${QUOTE}`)
			const el = quoteIn(editor)
			const question = el.querySelector('blockquote div')!.firstChild!
			document.getSelection()!.collapse(question, question.textContent!.length)
			pressEnter(el)
			type(el, () => (document.getSelection()!.anchorNode!.textContent = 'Yes.'))

			const html = editor.getHTML()
			expect(html).toBe(
				'<div>See below.</div><div class="frappe_mail_quote">On 9 Sep 2026, a@b.c wrote:' +
					'<blockquote><div>Can you ship on Friday?</div></blockquote><div>Yes.</div>' +
					'<blockquote><div>And the invoice?</div></blockquote></div>',
			)
			expect(readerSees(html)).toContain('Yes.')
			editor.destroy()
		})

		it('answers above the first quoted line on Enter there, and the reader shows the answer', () => {
			const editor = mounted(`<div>See below.</div>${QUOTE}`)
			const el = quoteIn(editor)
			document.getSelection()!.collapse(el.querySelector('blockquote div')!.firstChild!, 0)
			pressEnter(el)
			type(el, () => (document.getSelection()!.anchorNode!.textContent = 'All confirmed.'))

			expect(readerSees(editor.getHTML())).toBe(
				'See below.On 9 Sep 2026, a@b.c wrote:All confirmed.',
			)
			editor.destroy()
		})

		it('leaves Enter to the browser outside the quoted lines', () => {
			const editor = mounted(`<div>FYI</div><div class="frappe_mail_fwd"><div>The invoice.</div></div>`)
			const el = editor.view.dom.querySelector<HTMLElement>('.frappe_mail_fwd')!
			document.getSelection()!.collapse(el.querySelector('div')!.firstChild!, 3)
			const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
			el.dispatchEvent(enter)
			expect(enter.defaultPrevented).toBe(false)
			editor.destroy()
		})
	})
})
