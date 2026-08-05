// Pure HTML-string helpers, kept out of the utils barrel so they can be used (and
// tested) without pulling in its Vue-component and frappe-ui imports.

export const escapeHtml = (s: string) =>
	s.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
	)

// `<user@host>` in a body is an address, not markup — but the HTML parser reads it as
// an unknown tag and the sanitizer drops it, silently deleting the addresses a bounce
// notice is entirely about (its own `<a...>`-shaped text also fools hasHtmlContent
// below, so such a body can reach the reader as "HTML" either way). Escaping them has
// to happen before sanitizing, the last point where they still exist; the <b> marks
// the recipient the notice is reporting on.
// Deliberately loose about what an address may look like — `user@localhost` carries no
// dot, an address literal carries brackets (`user@[10.0.0.1]`), an internationalized
// mailbox carries neither in ASCII — because spelling out the grammar only decides
// which recipients still get deleted. The test applied is the parser's own: something
// with an `@` and no whitespace, which no real tag name can be.
const BRACKETED_ADDRESS = /<([^<>\s]+@[^<>\s]+)>/g

export const escapeBracketedAddresses = (html: string) =>
	html.replace(BRACKETED_ADDRESS, '<b>&lt;$1&gt;</b>')

export const hasHtmlContent = (content: string | null | undefined): boolean => {
	if (!content) return false
	return /<(html|head|body|div|p|span|table|td|tr|a|img|br|hr|h[1-6]|ul|ol|li|strong|em|b|i|font|style)[^>]*>/i.test(
		content,
	)
}
