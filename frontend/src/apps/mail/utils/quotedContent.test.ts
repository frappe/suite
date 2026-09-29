import { describe, expect, it } from 'vitest'

import { findQuoteRoots } from './quotedContent'

const parseDoc = (html: string) => new DOMParser().parseFromString(html, 'text/html')

// What the reader shows once every root is hidden.
const visibleText = (doc: Document) => {
	findQuoteRoots(doc).forEach((el) => el.remove())
	return doc.body.textContent!.replace(/\s+/g, ' ').trim()
}

describe('findQuoteRoots', () => {
	it('finds a Gmail trail and leaves the reply above it', () => {
		const doc = parseDoc(
			'<div>Sounds good.</div>' +
				'<div class="gmail_quote gmail_quote_container"><div class="gmail_attr">On Mon, A wrote:</div>' +
				'<blockquote class="gmail_quote">the original</blockquote></div>',
		)
		const roots = findQuoteRoots(doc)
		expect(roots).toHaveLength(1)
		expect(roots[0].classList.contains('gmail_quote_container')).toBe(true)
		expect(visibleText(doc)).toBe('Sounds good.')
	})

	it('finds a trail whose classes Outlook on the web prefixed with x_', () => {
		const doc = parseDoc(
			'<div>Thanks.</div>' +
				'<div class="x_frappe_mail_quote">On 18 Sep, a@b.c wrote:<blockquote>' +
				'<div class="x_gmail_quote">older</div></blockquote></div>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(1)
		expect(visibleText(doc)).toBe('Thanks.')
	})

	it("collapses everything from Outlook on the web's header to the end, marker included", () => {
		const doc = parseDoc(
			'<div>Please find the attached.</div>' +
				'<div id="appendonsend"></div><hr>' +
				'<div id="divRplyFwdMsg"><b>From:</b> A<br><b>Sent:</b> Friday<br><b>Subject:</b> Re: x</div>' +
				'<div><div>Hi, thanks for the list.</div></div>',
		)
		const roots = findQuoteRoots(doc)
		expect(roots).toHaveLength(1)
		expect(roots[0].firstElementChild?.id).toBe('appendonsend')
		expect(roots[0].textContent).toContain('thanks for the list')
		expect(visibleText(doc)).toBe('Please find the attached.')
	})

	it('finds the Outlook web header inside a forwarded message, and nothing above it', () => {
		// A Suite forward of a message Outlook sent: the forwarded body must stay visible, only the
		// trail Outlook appended under it collapses.
		const doc = parseDoc(
			'<div>The attachment is at the bottom.<br>---------- Forwarded message ---------</div>' +
				'<div class="frappe_mail_fwd"><div class="frappe_mail_embed">' +
				'<div class="elementToProof">Dear B,</div><div class="elementToProof">See attached.</div>' +
				'<div id="appendonsend"></div>' +
				'<div dir="ltr" id="divRplyFwdMsg"><b>From:</b> B</div>' +
				'<div><div>Hi,</div><div class="x_frappe_mail_quote">On 18 Sep wrote: <div class="x_gmail_quote">older</div></div></div>' +
				'</div></div>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(1)
		expect(visibleText(doc)).toBe(
			'The attachment is at the bottom.---------- Forwarded message ---------Dear B,See attached.',
		)
	})

	it('collapses an Apple Mail cite blockquote', () => {
		const doc = parseDoc(
			'<div>Yes.</div><div><br></div>' +
				'<div>On 18 Sep 2026, at 11:37, A &lt;a@b.c&gt; wrote:</div>' +
				'<blockquote type="cite"><div>the original</div></blockquote>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(1)
		expect(visibleText(doc)).toBe('Yes.On 18 Sep 2026, at 11:37, A <a@b.c> wrote:')
	})

	it("collapses Thunderbird's cite prefix with its blockquote", () => {
		const doc = parseDoc(
			'<p>Agreed.</p>' +
				'<div class="moz-cite-prefix">On 18/09/2026 11:37, A wrote:</div>' +
				'<blockquote type="cite">the original</blockquote>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(1)
		expect(visibleText(doc)).toBe('Agreed.')
	})

	it('gives an inline reply one root per cited block', () => {
		const doc = parseDoc(
			'<blockquote type="cite">question one</blockquote><div>answer one</div>' +
				'<blockquote type="cite">question two</blockquote><div>answer two</div>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(2)
		expect(visibleText(doc)).toBe('answer oneanswer two')
	})

	it('leaves a plain blockquote and a forwarded message alone', () => {
		const doc = parseDoc(
			'<blockquote>a pull quote in the body</blockquote>' +
				'<div class="frappe_mail_fwd">the forwarded message</div>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(0)
	})

	it('returns only the outermost root of nested trails', () => {
		const doc = parseDoc(
			'<div class="gmail_quote">one<div class="gmail_quote">two<blockquote type="cite">three</blockquote></div></div>',
		)
		const roots = findQuoteRoots(doc)
		expect(roots).toHaveLength(1)
		expect(roots[0].textContent).toBe('onetwothree')
	})
})
