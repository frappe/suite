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

	it('collapses root chains like `html > body` to the container', () => {
		const out = containEmailHtml(
			'<style>html > body { background-color: rgb(1, 2, 3); } html p { color: rgb(4, 5, 6); }</style><p>x</p>',
		)

		expect(out).toContain(`.${EMBED_CLASS} { background-color: rgb(1, 2, 3); }`)
		expect(out).toMatch(new RegExp(`\\.${EMBED_CLASS}\\s+p { color: rgb\\(4, 5, 6\\); }`))
	})

	it('attaches body qualifiers directly to the container', () => {
		const out = containEmailHtml('<style>body.dark { color: rgb(7, 8, 9); }</style><p>x</p>')

		expect(out).toContain(`.${EMBED_CLASS}.dark { color: rgb(7, 8, 9); }`)
	})

	it('keeps root descendants as descendants of the container', () => {
		const out = containEmailHtml(
			'<style>html .container { color: rgb(1, 0, 0); } :root #content { color: rgb(2, 0, 0); } html > .message { color: rgb(3, 0, 0); }</style><p>x</p>',
		)

		expect(out).toMatch(new RegExp(`\\.${EMBED_CLASS}\\s+\\.container { color: rgb\\(1, 0, 0\\); }`))
		expect(out).toMatch(new RegExp(`\\.${EMBED_CLASS}\\s+#content { color: rgb\\(2, 0, 0\\); }`))
		expect(out).toMatch(new RegExp(`\\.${EMBED_CLASS}\\s+> \\.message { color: rgb\\(3, 0, 0\\); }`))
	})

	it('does not split selectors on commas inside functional pseudo-classes', () => {
		const out = containEmailHtml(
			'<style>:not(.a, .b) { color: rgb(1, 1, 1); } .x, .y { color: rgb(2, 2, 2); }</style><p>x</p>',
		)

		expect(out).toContain(`.${EMBED_CLASS} :not(.a, .b) { color: rgb(1, 1, 1); }`)
		expect(out).toContain(`.${EMBED_CLASS} .x, .${EMBED_CLASS} .y { color: rgb(2, 2, 2); }`)
	})

	it('does not split selectors on commas inside quoted attribute values', () => {
		const out = containEmailHtml(
			'<style>[data-x="1,2"] { color: rgb(9, 9, 9); }</style><p>x</p>',
		)

		expect(out).toContain(`.${EMBED_CLASS} [data-x="1,2"] { color: rgb(9, 9, 9); }`)
	})

	it('drops @import rules', () => {
		const out = containEmailHtml(
			'<style>@import url("https://attacker.test/track.css"); p { color: rgb(3, 3, 3); }</style><p>x</p>',
		)

		expect(out).not.toContain('@import')
		expect(out).not.toContain('attacker.test')
		expect(out).toContain(`.${EMBED_CLASS} p { color: rgb(3, 3, 3); }`)
	})

	it('drops @font-face rules', () => {
		const out = containEmailHtml(
			'<style>@font-face { font-family: "T"; src: url("https://attacker.test/t.woff2"); } p { color: rgb(4, 4, 4); }</style><p>x</p>',
		)

		expect(out).not.toContain('@font-face')
		expect(out).not.toContain('attacker.test')
		expect(out).toContain(`.${EMBED_CLASS} p { color: rgb(4, 4, 4); }`)
	})

	it('scopes and filters inside grouping rules', () => {
		const out = containEmailHtml(
			'<style>@media screen { body { color: rgb(5, 5, 5); } @font-face { font-family: "T"; src: url("https://attacker.test/m.woff2"); } }</style><p>x</p>',
		)

		expect(out).toContain('@media screen')
		expect(out).toContain(`.${EMBED_CLASS} { color: rgb(5, 5, 5); }`)
		expect(out).not.toContain('attacker.test')
	})

	it('drops unrecognized at-rules instead of emitting them verbatim', () => {
		const out = containEmailHtml(
			'<style>@keyframes spin { from { transform: rotate(0deg); } } p { color: rgb(6, 6, 6); }</style><p>x</p>',
		)

		expect(out).not.toContain('@keyframes')
		expect(out).toContain(`.${EMBED_CLASS} p { color: rgb(6, 6, 6); }`)
	})

	it('keeps content markup untouched', () => {
		const out = containEmailHtml(
			'<table bgcolor="#ffffff"><tbody><tr><td style="padding: 8px">cell</td></tr></tbody></table>',
		)

		expect(out).toContain('<td style="padding: 8px">cell</td>')
		expect(out).toContain('bgcolor="#ffffff"')
	})
})
