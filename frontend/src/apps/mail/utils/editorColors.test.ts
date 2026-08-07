import { describe, expect, it } from 'vitest'
import * as cheerio from 'cheerio'

import { preserveEditorColors } from '@/apps/mail/utils/editorColors'

// Runs a body through the outbound pass the way processInlineImages does.
const outbound = (html: string) => {
	const $ = cheerio.load(html)
	preserveEditorColors($)
	return $('body').html() ?? ''
}

describe('resolving the editor’s colour variables', () => {
	it('replaces a text colour with its literal value', () => {
		const html = '<span style="color: var(--prose-color-blue)">tomorrow</span>'

		expect(outbound(html)).toBe('<span style="color: #1579D0">tomorrow</span>')
	})

	it('replaces a highlight colour with its literal value', () => {
		const html = '<mark style="background-color: var(--prose-highlight-yellow)">note</mark>'

		expect(outbound(html)).toContain('background-color: #fef08a')
	})

	// The variable is defined only inside .ProseMirror, so anything left holding one renders
	// uncoloured wherever the mail is actually read.
	it('leaves no prose variables behind', () => {
		const html =
			'<span style="color: var(--prose-color-red)">a</span>' +
			'<span style="color: var(--prose-color-green)">b</span>'

		expect(outbound(html)).not.toContain('var(--prose-')
	})

	// Better an unstyled word than a confidently wrong colour.
	it('leaves a colour it does not know as the variable', () => {
		const html = '<span style="color: var(--prose-color-chartreuse)">x</span>'

		expect(outbound(html)).toBe(html)
	})

	it.each([
		['<div>plain text</div>', 'a body with no colour'],
		['<span style="color: #1579D0">already resolved</span>', 'a body that went out before'],
		['<span style="color: var(--surface-blue-1)">app token</span>', 'a non-prose variable'],
	])('leaves %s untouched (%s)', (html) => {
		expect(outbound(html)).toBe(html)
	})
})

// Every browser's default stylesheet gives <mark> its own color, which beats a colour inherited
// from the span the editor wraps around it — so a coloured highlight arrives with black text.
describe('text colour inside a highlight', () => {
	it('survives the mark’s default colour', () => {
		const html =
			'<span style="color: var(--prose-color-orange)">' +
			'<mark style="background-color: var(--prose-highlight-orange)">Best,</mark></span>'

		const result = outbound(html)

		expect(result).toContain('color: #ea580c')
		expect(result).toContain('background-color: #fed7aa')
		expect(result).toContain('color: inherit')
	})

	it('does not override a colour the mark already carries', () => {
		const html = '<mark style="background-color: #fef08a; color: #dc2626">x</mark>'

		expect(outbound(html)).toBe(html)
	})

	it('is a no-op for an uncoloured highlight beyond the default it restores', () => {
		const html = '<mark style="background-color: #fef08a">x</mark>'

		expect(outbound(html)).toBe('<mark style="background-color: #fef08a; color: inherit">x</mark>')
	})
})

// A reply or a forward carries the other sender's message along with it. That part is their
// document, written against the browser default we would be overriding, so it is left as written.
describe('mail carried into a reply or forward', () => {
	it.each(['frappe_mail_quote', 'frappe_mail_fwd', 'gmail_quote'])(
		'keeps a highlight in a %s as written',
		(wrapper) => {
			const html = `<div class="${wrapper}"><mark style="background-color: #fef08a">theirs</mark></div>`

			expect(outbound(html)).toBe(html)
		},
	)

	it('still fixes the highlight above the quote', () => {
		const composed = '<mark style="background-color: #fef08a">mine</mark>'
		const quoted =
			'<div class="frappe_mail_quote"><mark style="background-color: #fef08a">theirs</mark></div>'

		const result = outbound(composed + quoted)

		expect(result).toContain('<mark style="background-color: #fef08a; color: inherit">mine</mark>')
		expect(result).toContain('<mark style="background-color: #fef08a">theirs</mark>')
	})

	// Our own earlier mail coming back in a quote still carries our variables, and they are as
	// unrenderable there as anywhere else.
	it('still resolves our colour variables inside a quote', () => {
		const html =
			'<div class="frappe_mail_quote"><span style="color: var(--prose-color-blue)">a</span></div>'

		expect(outbound(html)).toContain('color: #1579D0')
	})
})
