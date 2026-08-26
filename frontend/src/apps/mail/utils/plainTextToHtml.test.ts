import { describe, expect, it } from 'vitest'

import { plainTextToHtml } from '@/apps/mail/utils/html'

// Quoting or forwarding a plain-text mail used to wrap it in a <pre>, which the composer's
// editor parses as a code block. The recipient then got the sender's prose in monospace that
// never wrapped. These pin the shape that replaced it.
describe('plainTextToHtml', () => {
	it('turns newlines into breaks', () => {
		expect(plainTextToHtml('one\ntwo')).toBe('one<br>two')
	})

	it('keeps blank lines', () => {
		expect(plainTextToHtml('one\n\ntwo')).toBe('one<br><br>two')
	})

	it('normalises CRLF', () => {
		expect(plainTextToHtml('one\r\ntwo\rthree')).toBe('one<br>two<br>three')
	})

	it('escapes markup so a body cannot become one', () => {
		expect(plainTextToHtml('<b>not bold</b>')).toBe('&lt;b&gt;not bold&lt;/b&gt;')
	})

	it('keeps a bracketed address intact', () => {
		// The bounce-notice case: unescaped, the parser reads this as a tag and the
		// sanitizer deletes the address the notice is about.
		expect(plainTextToHtml('RCPT TO:<user@example.com>')).toContain('&lt;user@example.com&gt;')
	})

	it('does not double-escape an ampersand', () => {
		expect(plainTextToHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
	})

	it('keeps leading indentation', () => {
		// HTML collapses leading whitespace, and the editor drops the wrapper's style, so
		// the indent has to be non-breaking to survive either.
		expect(plainTextToHtml('  indented')).toBe('&nbsp;&nbsp;indented')
	})

	it('indents every line it needs to', () => {
		expect(plainTextToHtml('top\n    deep')).toBe('top<br>&nbsp;&nbsp;&nbsp;&nbsp;deep')
	})

	it('leaves quote markers alone', () => {
		expect(plainTextToHtml('> quoted\n>> deeper')).toBe('&gt; quoted<br>&gt;&gt; deeper')
	})

	it('emits no pre or code element', () => {
		const html = plainTextToHtml('def f():\n    return 1')
		expect(html).not.toMatch(/<(pre|code)\b/)
	})

	it('handles an empty string', () => {
		expect(plainTextToHtml('')).toBe('')
	})
})
