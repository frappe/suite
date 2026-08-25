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

// A leading chain of document-root tokens — `html`, `:root`, optionally ending in
// `body` — with optional child combinators: `body`, `html body`, `html > body`,
// `:root body`. The chain collapses into the scope itself. The match ends AT the
// last root token, never consuming what follows it: an attached qualifier
// (`body.dark`) glues onto the scope, while a descendant or child combinator
// (`html .container`, `html > .message`) keeps its separator.
const ROOT_CHAIN = /^(?:(?::root|html)(?![\w-])\s*>?\s*)*body(?![\w-])|^(?::root|html)(?![\w-])(?:\s*>?\s*(?::root|html)(?![\w-]))*/i

const scopeSelector = (selector: string): string => {
	const trimmed = selector.trim()
	if (!trimmed) return trimmed
	const replaced = trimmed.replace(ROOT_CHAIN, `${SCOPE} `).trim()
	if (replaced === trimmed) return `${SCOPE} ${trimmed}`
	// The chain was the whole selector, or its remainder attaches directly (`.dark`
	// from `body.dark`): no descendant space.
	return replaced.replace(new RegExp(`^${SCOPE} (?=[.:#[]|$)`), SCOPE)
}

// selectorText cannot be split on every comma: `:is(.a, .b)` carries commas of its
// own, and so can a quoted attribute value (`[data-x="1,2"]`). Split only at
// top level — outside parentheses, brackets and strings.
const splitSelectors = (text: string): string[] => {
	const parts: string[] = []
	let depth = 0
	let quote = ''
	let escaped = false
	let current = ''
	for (const char of text) {
		if (escaped) escaped = false
		else if (char === '\\') escaped = true
		else if (quote) {
			if (char === quote) quote = ''
		} else if (char === '"' || char === "'") quote = char
		else if (char === '(' || char === '[') depth++
		else if (char === ')' || char === ']') depth--
		else if (char === ',' && depth === 0) {
			parts.push(current)
			current = ''
			continue
		}
		current += char
	}
	parts.push(current)
	return parts
}

// Matched by the numeric type constant, not `instanceof CSSStyleRule`: not every
// environment defines that global, and a ReferenceError here would trip the
// fallback and silently disable containment.
const STYLE_RULE = 1

const rewriteRules = (rules: CSSRuleList): string =>
	Array.from(rules)
		.map((rule) => {
			if (rule.type === STYLE_RULE) {
				const styleRule = rule as CSSStyleRule
				const scoped = splitSelectors(styleRule.selectorText).map(scopeSelector).join(', ')
				return `${scoped} { ${styleRule.style.cssText} }`
			}
			// Any grouping rule — @media, @supports, @layer, @container, … — keeps its
			// prelude and has its contents passed back through this rewrite, so nothing
			// nested escapes scoping or filtering.
			const inner = (rule as { cssRules?: CSSRuleList }).cssRules
			if (inner) {
				const brace = rule.cssText.indexOf('{')
				if (brace === -1) return ''
				const body = rewriteRules(inner)
				return body ? `${rule.cssText.slice(0, brace).trim()} { ${body} }` : ''
			}
			// Everything else is dropped, not emitted verbatim — the catch-all is how
			// unknown constructs smuggle unscoped selectors or remote loads (@import,
			// @font-face src) past containment. Deny by default.
			return ''
		})
		.filter(Boolean)
		.join('\n')

// @import statements, dropped from the raw text before the fallback probe: the
// probe attaches the sheet to the live document, and browsers fetch a sheet's
// imports regardless of its media — the remote request would fire at compose
// time, from the composer's own browser.
const IMPORT_STATEMENT = /@import\b[^;]*;?/gi

// CSS parsing goes through the browser's CSS parser, never a hand-rolled one.
// Preferred door: a constructable stylesheet — parsed entirely off-document, and
// the platform itself rejects @import there, so nothing can ever be fetched.
// Fallback (environments without replaceSync, e.g. jsdom): a <style> probe
// attached under media="not all", with @import stripped from the text first.
const parseCss = (css: string): CSSRuleList | null => {
	try {
		const sheet = new CSSStyleSheet()
		sheet.replaceSync(css)
		return sheet.cssRules
	} catch {
		// Constructable sheets unsupported (or the CSS made replaceSync throw)
	}

	const probe = document.createElement('style')
	probe.media = 'not all'
	probe.textContent = css.replace(IMPORT_STATEMENT, '')
	document.head.appendChild(probe)
	try {
		return probe.sheet?.cssRules ?? null
	} finally {
		probe.remove()
	}
}

const scopeCss = (css: string): string => {
	const rules = parseCss(css)
	return rules ? rewriteRules(rules) : ''
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
