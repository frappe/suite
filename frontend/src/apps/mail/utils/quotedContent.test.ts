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

	it('folds a quoted message whole, its own inline answers included', () => {
		const doc = parseDoc(
			'<div>Thanks for the response.</div>' +
				'<blockquote type="cite"><div>On 4 Feb 2026, at 10:05 AM, B wrote:</div>' +
				'<div>Hi A,</div><blockquote><div>Progress seems slow.</div></blockquote>' +
				'<div>Which areas do you mean?</div></blockquote>',
		)
		expect(findQuoteRoots(doc)).toHaveLength(1)
		expect(visibleText(doc)).toBe('Thanks for the response.')
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
			'<div>Reply.</div>' +
				'<div class="gmail_quote">one<blockquote class="gmail_quote">two<blockquote type="cite">three</blockquote></blockquote></div>',
		)
		const roots = findQuoteRoots(doc)
		expect(roots).toHaveLength(1)
		expect(roots[0].textContent).toBe('onetwothree')
	})

	describe('keeps on view what the reader has not read', () => {
		it('shows a message forwarded from Gmail, under the note above it', () => {
			const doc = parseDoc(
				'<div>Sharing the course link again.</div><br>' +
					'<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">' +
					'---------- Forwarded message ---------<br>From: <b>A</b><br>Subject: QMS Refresher</div>' +
					'<br><br><div dir="ltr">Course link: launchpad</div></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})

		it('shows a Gmail forward whatever language its header is in', () => {
			const doc = parseDoc(
				'<div>FYI</div>' +
					'<div class="gmail_quote"><div class="gmail_attr">' +
					'---------- Weitergeleitete Nachricht ---------<br>Von: A</div>' +
					'<div>Die Rechnung ist da.</div></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})

		it('still folds the history a forwarded message carries', () => {
			const doc = parseDoc(
				'<div>FYI</div>' +
					'<div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------</div>' +
					'<div>Approved.</div>' +
					'<div class="gmail_quote"><div class="gmail_attr">On Mon, B wrote:</div>' +
					'<blockquote class="gmail_quote">Can we approve this?</blockquote></div></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(1)
			expect(visibleText(doc)).toBe('FYI---------- Forwarded message ---------Approved.')
		})

		it('shows a message forwarded from Apple Mail on a Mac', () => {
			const doc = parseDoc(
				'<div>FYI</div><div><br><blockquote type="cite"><div>Begin forwarded message:</div>' +
					'<br class="Apple-interchange-newline"><div><b>From: </b>A</div><div>The invoice.</div>' +
					'</blockquote></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})

		it('shows a message forwarded from an iPhone', () => {
			const doc = parseDoc(
				'<div dir="ltr">FYI</div>' +
					'<div dir="ltr"><br><blockquote type="cite">Begin forwarded message:<br><br></blockquote></div>' +
					'<blockquote type="cite"><div dir="ltr"><b>From:</b> A</div><div>The invoice.</div></blockquote>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})

		it('shows answers typed inside a Gmail quote, folding only the history after them', () => {
			const doc = parseDoc(
				'<div>Answers inline.</div>' +
					'<div class="gmail_quote"><div class="gmail_attr">On Mon, A wrote:</div>' +
					'<blockquote class="gmail_quote">Can you ship on Friday?</blockquote>' +
					'<div>Yes, in the morning.</div>' +
					'<blockquote class="gmail_quote">Thanks, A<div class="gmail_quote">On Sun, B wrote: older</div></blockquote>' +
					'</div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(1)
			expect(visibleText(doc)).toBe(
				'Answers inline.On Mon, A wrote:Can you ship on Friday?Yes, in the morning.',
			)
		})

		it('shows answers typed between the lines of our own quote', () => {
			const doc = parseDoc(
				'<div>See below.</div>' +
					'<div class="frappe_mail_quote">On 9 Sep, a@b.c wrote:' +
					'<blockquote>Can you ship on Friday?</blockquote><div>Yes.</div>' +
					'<blockquote>And the invoice?</blockquote><div>Sent.</div></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})

		it('reads an attribution written as text and inline markup as one line', () => {
			const doc = parseDoc(
				'<div>Following up.</div>' +
					'<div class="gmail_quote">On Tue, 7 Jul, Amy <span>&lt;amy@x.test&gt;</span> wrote:<br>' +
					'<blockquote class="gmail_quote">Any thoughts?</blockquote></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(1)
			expect(visibleText(doc)).toBe('Following up.')
		})

		it('shows an answer typed above the first quoted line, folding the quote under it', () => {
			const doc = parseDoc(
				'<div>See below.</div>' +
					'<div class="frappe_mail_quote">On 9 Sep, a@b.c wrote:' +
					'<div>Yes, all three.</div>' +
					'<blockquote>Can you confirm the three points?</blockquote></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(1)
			expect(visibleText(doc)).toBe('See below.On 9 Sep, a@b.c wrote:Yes, all three.')
		})

		it('folds the history after the last answer typed inside our own quote', () => {
			const doc = parseDoc(
				'<div>See below.</div>' +
					'<div class="frappe_mail_quote">On 9 Sep, a@b.c wrote:' +
					'<blockquote>Can you ship on Friday?</blockquote><div>Yes.</div>' +
					'<blockquote>Thanks, A. On 8 Sep, B wrote: older</blockquote></div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(1)
			expect(visibleText(doc)).toBe('See below.On 9 Sep, a@b.c wrote:Can you ship on Friday?Yes.')
		})

		it('shows a mail that is nothing but a quote', () => {
			const doc = parseDoc(
				'<style>p { margin: 0 }</style>' +
					'<div id="divRplyFwdMsg"><b>From:</b> A<br><b>Subject:</b> FW: Invoice</div>' +
					'<div>The invoice is attached.</div>',
			)
			expect(findQuoteRoots(doc)).toHaveLength(0)
		})
	})
})
