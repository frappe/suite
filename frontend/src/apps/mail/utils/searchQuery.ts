const VALUE_OPERATORS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'after', 'before'])

export function parseMailSearchQuery(query: string): Record<string, string> {
	const filter: Record<string, string> = {}
	const text: string[] = []
	const tokens = query.match(/[a-z]+:(?:"[^"]*"|\S+)|"[^"]*"|\S+/gi) ?? []

	for (const token of tokens) {
		const separator = token.indexOf(':')
		if (separator === -1) {
			text.push(token)
			continue
		}

		const operator = token.slice(0, separator).toLowerCase()
		const value = token.slice(separator + 1).replace(/^"|"$/g, '')
		if (!value) continue

		if (VALUE_OPERATORS.has(operator)) filter[operator] = value
		else if (operator === 'has' && ['attachment', 'attachments'].includes(value.toLowerCase()))
			filter.hasAttachment = 'true'
		else if (operator === 'has' && ['no-attachment', 'no-attachments'].includes(value.toLowerCase()))
			filter.hasAttachment = 'false'
		else if (operator === 'is' && ['read', 'unread'].includes(value.toLowerCase()))
			filter.isRead = String(value.toLowerCase() === 'read')
		else text.push(token)
	}

	if (text.length) filter.text = text.join(' ')
	return filter
}
