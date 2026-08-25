// Structure a plain-text body carries in its own punctuation: `>` for the reply trail and
// RFC 3676's '-- ' for the signature. The HTML path gets both for free (blockquote elements,
// a marked signature block); without this the same message read as text is one flat wall.

type PlainTextBlockKind = 'body' | 'quote' | 'signature'

export interface PlainTextBlock {
	kind: PlainTextBlockKind
	/** Quote nesting, 0 for body and signature. */
	depth: number
	/** The text with its quote markers removed, so it renders as prose at any depth. */
	text: string
}

// `>>text`, `> > text` and `>  text` all mean the same nesting. The run is the markers plus
// the single space each conventionally carries.
const QUOTE_PREFIX = /^((?:>[ \t]?)+)/

const quoteDepth = (line: string) =>
	line.match(QUOTE_PREFIX)?.[1].match(/>/g)?.length ?? 0

const stripQuotePrefix = (line: string) => line.replace(QUOTE_PREFIX, '')

// RFC 3676 4.3 wants exactly '-- ', but plenty of clients trim the trailing space before it
// reaches anyone, so both spellings count.
const isSeparator = (line: string) => line === '-- ' || line === '--'

export const splitPlainText = (text: string): PlainTextBlock[] => {
	if (!text) return []

	const lines = text.replace(/\r\n?/g, '\n').split('\n')

	// The last separator wins: a '--' someone typed mid-message would otherwise swallow the
	// real signature below it. Only unquoted ones count, since a quoted separator belongs to
	// the message being quoted.
	let signatureAt = -1
	lines.forEach((line, index) => {
		if (quoteDepth(line) === 0 && isSeparator(line)) signatureAt = index
	})

	const blocks: PlainTextBlock[] = []
	lines.forEach((line, index) => {
		const inSignature = signatureAt !== -1 && index >= signatureAt
		const depth = inSignature ? 0 : quoteDepth(line)
		const kind: PlainTextBlockKind = inSignature
			? 'signature'
			: depth
				? 'quote'
				: 'body'
		const content = inSignature ? line : stripQuotePrefix(line)
		const last = blocks.at(-1)
		if (last && last.kind === kind && last.depth === depth)
			last.text += '\n' + content
		else blocks.push({ kind, depth, text: content })
	})

	// A body block of nothing but blank lines is the gap around a quote, not content.
	return blocks.filter((block) => block.kind !== 'body' || block.text.trim())
}

export interface PlainTextSegment {
	kind: PlainTextBlockKind
	blocks: PlainTextBlock[]
}

// A reply trail is one trail however many levels deep it goes, so a reader folds it behind a
// single control rather than one per level.
export const groupPlainText = (text: string): PlainTextSegment[] =>
	splitPlainText(text).reduce<PlainTextSegment[]>((segments, block) => {
		const last = segments.at(-1)
		if (block.kind === 'quote' && last?.kind === 'quote')
			last.blocks.push(block)
		else segments.push({ kind: block.kind, blocks: [block] })
		return segments
	}, [])
