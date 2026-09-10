const VALUE_OPERATORS = new Set(['from', 'to', 'cc', 'bcc', 'subject', 'after', 'before'])

const OPERATOR_CONTEXT = {
	in: { label: 'Folder', prompt: 'Choose a folder' },
	from: { label: 'From', prompt: 'Enter a sender email address' },
	to: { label: 'To', prompt: 'Enter a recipient email address' },
	cc: { label: 'Cc', prompt: 'Enter a Cc recipient email address' },
	bcc: { label: 'Bcc', prompt: 'Enter a Bcc recipient email address' },
	subject: { label: 'Subject', prompt: 'Enter words from the subject' },
	after: { label: 'After', prompt: 'Enter a date, for example 2026-01-01' },
	before: { label: 'Before', prompt: 'Enter a date, for example 2026-01-31' },
	has: { label: 'Has', prompt: 'Enter attachment or no-attachment' },
	is: { label: 'Is', prompt: 'Enter read or unread' },
} as const

export function getMailSearchOperatorContext(query: string) {
	const match = query.match(/(?:^|\s)(in|from|to|cc|bcc|subject|after|before|has|is):\s*$/i)
	if (!match) return null
	return OPERATOR_CONTEXT[match[1].toLowerCase() as keyof typeof OPERATOR_CONTEXT]
}

export function getMailContactOperator(query: string) {
	const match = query.match(/(?:^|\s)(from|to|cc|bcc):([^\s]*)$/i)
	if (!match) return null
	return { key: match[1].toLowerCase(), partial: match[2] }
}

export function getMailChoiceOperator(query: string) {
	const match = query.match(/(?:^|\s)(in|has|is):([^\s]*)$/i)
	if (!match) return null
	return { key: match[1].toLowerCase(), partial: match[2] }
}

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
