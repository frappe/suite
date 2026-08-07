import type { CheerioAPI } from 'cheerio'

// The editor writes a named colour as `color: var(--prose-color-blue)`, and that variable is only
// ever defined inside `.ProseMirror`. Everywhere else the declaration is invalid and the text falls
// back to the inherited colour: the recipient's client shows black, and so does our own reader,
// which renders the body in an iframe that never sees the app's stylesheet. That is why a
// coloured line reads as uncoloured in Sent — the sender's copy is stripped just like the
// recipient's is.
//
// So the variable has to be resolved to a literal colour before the body leaves the editor.
//
// Deliberately the light-scheme value, not the current theme's: a sent mail is a fixed document,
// and the reader remaps light-scheme mail onto the dark canvas at display time (see darkMail.ts).
// Baking dark colours into the wire format would defeat that and reach the recipient wrong.
//
// The values are frappe-ui's own — `textColorHexMap` and `highlightColorHexMap` in
// TextEditor/extensions/shared/color-utils.ts. They are copied rather than imported because that
// module isn't in frappe-ui's package exports. They double as the extension's own legacy parse
// map, so a body written this way still reads back as a named colour when a draft is reopened.
const TEXT_COLORS: Record<string, string> = {
	black: '#000000',
	red: '#dc2626',
	blue: '#1579D0',
	green: '#16a34a',
	yellow: '#ca8a04',
	orange: '#ea580c',
	purple: '#9333ea',
	pink: '#db2777',
	gray: '#6b7280',
	indigo: '#4f46e5',
	teal: '#0d9488',
	cyan: '#06b6d4',
}

const HIGHLIGHT_COLORS: Record<string, string> = {
	red: '#fecaca',
	blue: '#bfdbfe',
	green: '#bbf7d0',
	yellow: '#fef08a',
	orange: '#fed7aa',
	purple: '#e9d5ff',
	pink: '#fbcfe8',
	gray: '#e5e7eb',
	indigo: '#c7d2fe',
	teal: '#99f6e4',
	cyan: '#a5f3fc',
}

const PROSE_COLOR_VAR = /var\(--prose-(color|highlight)-([a-z]+)\)/g

// A name we don't know is left as the variable rather than guessed at: an unstyled word is a
// smaller loss than a confidently wrong colour, and it keeps a colour added upstream from being
// silently flattened to something else.
export const resolveColorVariables = (style: string) =>
	style.replace(PROSE_COLOR_VAR, (variable, kind: string, name: string) => {
		const palette = kind === 'color' ? TEXT_COLORS : HIGHLIGHT_COLORS
		return palette[name] ?? variable
	})

// Text colour and highlight are separate marks, so colouring a highlighted run nests them:
// `<span style="color: …"><mark style="background-color: …">`. That looks right in the editor
// and is wrong the moment it leaves, because every browser's default stylesheet gives <mark> its
// own `color`, and a colour set *on* the element beats one inherited from an ancestor. The
// highlight survives, the text colour is overruled, and the words come out black on the
// background — which is exactly what Gmail shows.
//
// `inherit` is the fix rather than the resolved hex, because it is correct whichever way round
// the two marks happen to nest, and it is a no-op when the run isn't coloured at all. Marks that
// already carry a colour of their own are left alone.
// Quoted mail is somebody else's document, and a <mark> in it was written expecting the browser
// default we would be overriding — so `inherit` there could recolour their words from whatever
// element happens to enclose the quote. Left alone. (Both spellings, because the quote may be one
// of ours or one carried in from Gmail, and openQuotedContent folds it straight into the body, so
// the two can't be told apart by which string they arrived in.)
const QUOTE = '.frappe_mail_quote, .gmail_quote'

const keepTextColorThroughHighlights = ($: CheerioAPI) => {
	$('mark').each((_, element) => {
		const mark = $(element)
		if (mark.closest(QUOTE).length) return

		const style = mark.attr('style') ?? ''
		if (/(^|;)\s*color\s*:/.test(style)) return

		mark.attr('style', style ? `${style.replace(/;\s*$/, '')}; color: inherit` : 'color: inherit')
	})
}

// Everything that has to happen to the editor's colours before a body goes on the wire.
export const preserveEditorColors = ($: CheerioAPI) => {
	// Variables are resolved everywhere, quotes included: only our own editor writes them, so one
	// inside a quote is our earlier mail coming back and would render just as broken as the first
	// time. It is the mark rewrite below that has to keep its hands off other people's markup.
	$('[style]').each((_, element) => {
		const styled = $(element)
		styled.attr('style', resolveColorVariables(styled.attr('style')!))
	})

	keepTextColorThroughHighlights($)
}
