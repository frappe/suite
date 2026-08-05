import { escapeHtml } from '@/apps/mail/utils/html'

import type { ComposeMailData, DraftRecipient } from '@/apps/mail/types'

// RFC 6068 `mailto:` links, turned into a draft. Clicking one in a message should open
// this app's composer, not hand the OS's default mail client a half-written mail.
//
// Percent-decoding is done per field rather than through URLSearchParams: that treats
// `+` as a space, which would quietly break plus-addressed recipients (`user+tag@…`),
// and splits are done before decoding so an encoded comma stays inside its address.

const decode = (value: string) => {
	try {
		return decodeURIComponent(value)
	} catch {
		// A malformed escape is worth showing literally rather than dropping the field.
		return value
	}
}

const recipients = (list: string | undefined): DraftRecipient[] =>
	(list ?? '')
		.split(',')
		.map((address) => decode(address).trim())
		.filter(Boolean)
		.map((email) => ({ email }))

// The body arrives as plain text; the editor speaks divs (see CustomParagraphExtension),
// and an empty line needs the <br> to survive the round trip.
const toHtml = (text: string) =>
	text
		.split(/\r?\n/)
		.map((line) => `<div>${escapeHtml(line) || '<br>'}</div>`)
		.join('')

export const parseMailto = (href: string): ComposeMailData | null => {
	if (!/^mailto:/i.test(href)) return null

	const target = href.slice('mailto:'.length)
	const separator = target.indexOf('?')
	const addresses = separator < 0 ? target : target.slice(0, separator)

	// First occurrence of a header wins, so a link can't quietly append a second
	// recipient list behind the one the user can see.
	const headers = new Map<string, string>()
	for (const pair of (separator < 0 ? '' : target.slice(separator + 1)).split('&')) {
		if (!pair) continue
		const equals = pair.indexOf('=')
		const key = decode(equals < 0 ? pair : pair.slice(0, equals)).toLowerCase()
		if (!headers.has(key)) headers.set(key, equals < 0 ? '' : decode(pair.slice(equals + 1)))
	}

	const subject = headers.get('subject')
	const body = headers.get('body')

	return {
		to: [...recipients(addresses), ...recipients(headers.get('to'))],
		cc: recipients(headers.get('cc')),
		bcc: recipients(headers.get('bcc')),
		...(subject ? { subject } : {}),
		...(body ? { html_body: toHtml(body) } : {}),
	}
}
