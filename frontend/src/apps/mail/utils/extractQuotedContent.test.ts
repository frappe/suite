import { describe, expect, it } from 'vitest'

import { extractQuotedContent } from '@/apps/mail/utils'

// Splitting a saved draft back into editable body + opaque quote. The quote wrapper must
// never re-enter the editor (its schema would strip the original mail's formatting), so
// both the reply wrapper and the forward wrapper have to be recognized here.

describe('extractQuotedContent', () => {
	it('splits out a reply quote', () => {
		const { quoted_content, html_body } = extractQuotedContent(
			'<div>my reply</div><div class="frappe_mail_quote"><blockquote>original</blockquote></div>',
		)

		expect(html_body).toBe('<div>my reply</div>')
		expect(quoted_content).toContain('frappe_mail_quote')
		expect(quoted_content).toContain('original')
	})

	it('splits out a forwarded original', () => {
		const { quoted_content, html_body } = extractQuotedContent(
			'<div>fyi</div><div class="frappe_mail_fwd">---------- Forwarded message ---------<table><tbody><tr><td style="padding: 8px">original</td></tr></tbody></table></div>',
		)

		expect(html_body).toBe('<div>fyi</div>')
		expect(quoted_content).toContain('frappe_mail_fwd')
		// the point of the split: the original's markup survives untouched
		expect(quoted_content).toContain('<td style="padding: 8px">original</td>')
	})

	it('leaves a body without a quote untouched', () => {
		const { quoted_content, html_body } = extractQuotedContent('<div>just text</div>')

		expect(html_body).toBe('<div>just text</div>')
		expect(quoted_content).toBe('')
	})

	it('handles an empty body', () => {
		expect(extractQuotedContent(undefined)).toEqual({ quoted_content: '', html_body: '' })
	})
})
