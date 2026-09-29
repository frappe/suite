/**
 * Find the quoted reply trail(s) in a rendered message so the reader can collapse them.
 *
 * Every client marks its trail differently. Gmail, Yahoo, Proton, Zoho and our own composer wrap
 * it in a classed container. Apple Mail and Thunderbird use `<blockquote type="cite">`,
 * Thunderbird with a classed attribution line as the sibling just before it. Outlook on the web
 * wraps nothing: it drops a From/Sent/To/Subject header into the flow and the original message
 * simply follows as its siblings. It also rewrites every class and id in content it quotes with
 * an `x_` prefix (gmail_quote → x_gmail_quote), so a Gmail reply that passed through Outlook only
 * ever arrives prefixed.
 *
 * `findQuoteRoots` normalises all of that into a list of outermost elements, one per trail.
 * Sibling-run trails (Outlook, Thunderbird with its attribution line) are wrapped in a fresh
 * `<div>` first so each trail is a single node the caller can hide and toggle. The backend's
 * `preview_from_html` applies the same rules — keep the two in step.
 */

const QUOTE_CLASS =
	/^(?:x_)?(?:gmail_quote|frappe_mail_quote|yahoo_quoted|protonmail_quote|zmail_extra)$/
// Thunderbird's "On … wrote:" line, a sibling just before its <blockquote type="cite">.
const CITE_PREFIX_CLASS = /^(?:x_)?moz-cite-prefix$/
// Outlook on the web: an empty marker, then the header the original message follows.
const OUTLOOK_MARKER_ID = /^(?:x_)?appendonsend$/
const OUTLOOK_WEB_HEADER_ID = /^(?:x_)?divRplyFwdMsg$/

const hasClass = (el: Element, pattern: RegExp) =>
	Array.from(el.classList).some((c) => pattern.test(c))

// Wrap `first` and every sibling after it in one <div>, returning the wrapper.
const wrapTrail = (first: Node) => {
	const wrapper = first.ownerDocument!.createElement('div')
	first.parentNode!.insertBefore(wrapper, first)
	while (wrapper.nextSibling) wrapper.appendChild(wrapper.nextSibling)
	return wrapper
}

// Wrap `nodes` (contiguous siblings, in order) in one <div>, returning the wrapper.
const wrapRun = (nodes: Node[]) => {
	const wrapper = nodes[0].ownerDocument!.createElement('div')
	nodes[0].parentNode!.insertBefore(wrapper, nodes[0])
	nodes.forEach((n) => wrapper.appendChild(n))
	return wrapper
}

// Outlook's trail starts at the marker/rule just before its header when they're present.
const outlookTrailStart = (header: Element) => {
	let start: Element = header
	for (let prev = start.previousElementSibling; prev; prev = prev.previousElementSibling) {
		if (prev.tagName !== 'HR' && !OUTLOOK_MARKER_ID.test(prev.id)) break
		start = prev
	}
	return start
}

// Thunderbird's attribution line before a cite blockquote, when there is one.
const attributionBefore = (quote: Element) => {
	const prev = quote.previousElementSibling
	return prev && hasClass(prev, CITE_PREFIX_CLASS) ? prev : null
}

export const findQuoteRoots = (root: ParentNode): Element[] => {
	const candidates = new Set<Element>()

	root.querySelectorAll('[class]').forEach((el) => {
		if (hasClass(el, QUOTE_CLASS)) candidates.add(el)
	})

	root.querySelectorAll('[id]').forEach((el) => {
		if (OUTLOOK_WEB_HEADER_ID.test(el.id)) candidates.add(wrapTrail(outlookTrailStart(el)))
	})

	root.querySelectorAll('blockquote[type]').forEach((el) => {
		if (el.getAttribute('type')?.toLowerCase() !== 'cite') return
		const attribution = attributionBefore(el)
		candidates.add(attribution ? wrapRun([attribution, el]) : el)
	})

	// Only the outermost of each trail: hiding it hides whatever is quoted inside it.
	return Array.from(candidates).filter((el) => {
		for (let p = el.parentElement; p; p = p.parentElement) if (candidates.has(p)) return false
		return true
	})
}
