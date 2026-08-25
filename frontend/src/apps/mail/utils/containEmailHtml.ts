/**
 * Contain an original mail's markup so it can be embedded inside another mail
 * (reply quote / forward) without its styling leaking into the host document.
 *
 * An email is authored as a full document: its <style> rules target `body`/`html`
 * and bare element selectors, and its <body> may carry a background of its own.
 * Embedded verbatim, those rules repaint the ENTIRE host mail (e.g. a dark
 * marketing backdrop bleeding over the sender's own text). Stripping the styles
 * instead (what the editor round-trip used to do) destroys the original's look.
 *
 * So: keep the styles, but rewrite every selector to live under one container —
 * `body`/`html`/`:root` become the container itself (its backdrop paints there,
 * and only there), and every other selector is prefixed with it.
 */

// The class the returned container carries; selectors are scoped to it.
export const EMBED_CLASS = 'frappe_mail_embed'
const SCOPE = `.${EMBED_CLASS}`

// A selector's leading document-root token, to be replaced by the scope itself:
// `body`, `html`, `html body`, `:root`, including forms like `body.dark` or `body > table`.
const ROOT_TOKEN = /^(?::root|html(?:\s+body)?|body)(?![\w-])/i

const scopeSelector = (selector: string): string => {
	const trimmed = selector.trim()
	if (!trimmed) return trimmed
	const replaced = trimmed.replace(ROOT_TOKEN, SCOPE)
	return replaced === trimmed ? `${SCOPE} ${trimmed}` : replaced
}

const rewriteRules = (rules: CSSRuleList): string =>
	Array.from(rules)
		.map((rule) => {
			if (rule instanceof CSSStyleRule) {
				const scoped = rule.selectorText.split(',').map(scopeSelector).join(', ')
				return `${scoped} { ${rule.style.cssText} }`
			}
			if (rule instanceof CSSMediaRule)
				return `@media ${rule.media.mediaText} { ${rewriteRules(rule.cssRules)} }`
			if (rule instanceof CSSSupportsRule)
				return `@supports ${rule.conditionText} { ${rewriteRules(rule.cssRules)} }`
			// @font-face, @keyframes, @import …: nothing selector-scoped to rewrite
			return rule.cssText
		})
		.join('\n')

// CSS parsing goes through the browser's CSSOM: the block is attached to the live
// document under media="not all" (parsed but never applied) just long enough to
// read its object model back out.
const scopeCss = (css: string): string => {
	const probe = document.createElement('style')
	probe.media = 'not all'
	probe.textContent = css
	document.head.appendChild(probe)
	try {
		const sheet = probe.sheet
		if (!sheet) return ''
		return rewriteRules(sheet.cssRules)
	} finally {
		probe.remove()
	}
}

export const containEmailHtml = (html: string): string => {
	try {
		const doc = new DOMParser().parseFromString(html, 'text/html')

		// Gather the document's styles (head and body), scoped; drop external sheets —
		// they can't be scoped and mail clients block them anyway.
		const styles = Array.from(doc.querySelectorAll('style'))
			.map((style) => {
				const css = style.textContent || ''
				style.remove()
				return scopeCss(css)
			})
			.filter(Boolean)
		doc.querySelectorAll('link[rel="stylesheet" i]').forEach((link) => link.remove())

		const container = doc.createElement('div')
		container.className = EMBED_CLASS
		// The body's own presentation moves onto the container, so an authored
		// backdrop still paints — inside the embed, not across the host mail.
		const body = doc.body
		const bodyStyle = body.getAttribute('style')
		if (bodyStyle) container.setAttribute('style', bodyStyle)
		const bgcolor = body.getAttribute('bgcolor')
		if (bgcolor) container.style.backgroundColor = bgcolor

		if (styles.length) container.innerHTML = `<style>${styles.join('\n')}</style>`
		container.innerHTML += body.innerHTML

		return container.outerHTML
	} catch {
		// Containment is an enhancement; a parser hiccup must not lose the content.
		return html
	}
}
