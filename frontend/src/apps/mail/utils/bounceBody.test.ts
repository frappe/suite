import { describe, expect, it } from 'vitest'
import DOMPurify from 'dompurify'

import { escapeBracketedAddresses, escapeHtml, hasHtmlContent } from '@/apps/mail/utils/html'

// A real MAILER-DAEMON bounce: no markup, addresses in angle brackets.
const BOUNCE = `Your message could not be delivered to the following recipients:

<arushi@frappe.io> (host 'localhost' rejected command 'RCPT TO:<arushi@frappe.io>' with code 550 (5.5.0) 'This account is not authorized to receive email.')`

describe('addresses in angle brackets', () => {
	// The failure this all guards against: the parser reads <arushi@frappe.io> as a tag and
	// the sanitizer drops it, deleting the address the notice is about — while the text
	// around it survives, so nothing looks obviously broken.
	it('are destroyed by sanitization when passed through raw', () => {
		const sanitized = DOMPurify.sanitize(`<pre>${BOUNCE}</pre>`)

		expect(sanitized).not.toContain('arushi@frappe.io')
		expect(sanitized).toContain('with code 550')
	})

	it('survive when escaped as plain text', () => {
		const sanitized = DOMPurify.sanitize(`<pre>${escapeHtml(BOUNCE)}</pre>`)

		expect(sanitized).toContain('&lt;arushi@frappe.io&gt;')
		expect(sanitized).toContain('RCPT TO:&lt;arushi@frappe.io&gt;')
	})

	it('survive inside a body that is treated as HTML', () => {
		const sanitized = DOMPurify.sanitize(escapeBracketedAddresses(`<div>${BOUNCE}</div>`))

		expect(sanitized).toContain('&lt;arushi@frappe.io&gt;')
		expect(sanitized).toContain('RCPT TO:<b>&lt;arushi@frappe.io&gt;</b>')
	})

	// Which is the path a bounce actually takes: its own bracketed addresses look enough
	// like an <a> tag to pass the markup sniff, so the body is handed over as HTML.
	it('make a plain-text body look like markup', () => {
		expect(hasHtmlContent(BOUNCE)).toBe(true)
	})

	// Recipients a stricter address grammar would have kept deleting: a local MTA's
	// dotless host, an address literal, a domain that is not ASCII.
	it.each([
		['user@localhost', 'a dotless host'],
		['user@[192.168.1.1]', 'an address literal'],
		['user@例え.jp', 'an internationalized domain'],
		["odd'name+tag@sub.example.co.uk", 'a local part with punctuation'],
	])('survive for %s (%s)', (address) => {
		const sanitized = DOMPurify.sanitize(escapeBracketedAddresses(`<div>To <${address}></div>`))

		expect(sanitized).toContain(address)
	})

	it('leave real markup alone', () => {
		const html = '<a href="mailto:x@y.com" title="Mail x@y.com">Write</a>'

		expect(escapeBracketedAddresses(html)).toBe(html)
	})
})
