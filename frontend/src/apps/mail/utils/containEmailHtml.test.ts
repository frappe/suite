import { describe, expect, it } from 'vitest'

import { EMBED_CLASS, containEmailHtml } from '@/apps/mail/utils/containEmailHtml'

// Embedding an original mail into a quote/forward: its document-level styling must
// paint inside the embed only, never across the host mail.

describe('containEmailHtml', () => {
	it('scopes a body background rule to the container', () => {
		const out = containEmailHtml(
			'<html><head><style>body { background-color: rgb(35, 47, 62); }</style></head><body><p>hi</p></body></html>',
		)

		expect(out).toContain(`class="${EMBED_CLASS}"`)
		expect(out).toContain(`.${EMBED_CLASS} { background-color: rgb(35, 47, 62); }`)
		expect(out).not.toMatch(/<style>[^<]*\bbody\b/)
		expect(out).toContain('<p>hi</p>')
	})

	it('prefixes ordinary selectors with the container', () => {
		const out = containEmailHtml('<style>.footer a { color: rgb(255, 0, 0); }</style><p>x</p>')

		expect(out).toContain(`.${EMBED_CLASS} .footer a { color: rgb(255, 0, 0); }`)
	})

	it('moves body presentation attributes onto the container', () => {
		const out = containEmailHtml('<html><body bgcolor="#232f3e"><p>x</p></body></html>')

		expect(out).toMatch(new RegExp(`class="${EMBED_CLASS}"[^>]*background-color`))
	})

	it('drops external stylesheets', () => {
		const out = containEmailHtml(
			'<html><head><link rel="stylesheet" href="https://x.test/a.css"></head><body><p>x</p></body></html>',
		)

		expect(out).not.toContain('<link')
		expect(out).toContain('<p>x</p>')
	})

	it('keeps content markup untouched', () => {
		const out = containEmailHtml(
			'<table bgcolor="#ffffff"><tbody><tr><td style="padding: 8px">cell</td></tr></tbody></table>',
		)

		expect(out).toContain('<td style="padding: 8px">cell</td>')
		expect(out).toContain('bgcolor="#ffffff"')
	})
})
