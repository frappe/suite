// The Screening mailbox is a plain named folder (no JMAP role), created server-side as "Screener";
// it's surfaced to users as the "Screener".
export const SCREENER_MAILBOX_NAME = 'Screener'

export const getAttachmentOptions = () => [
	{ label: __('All'), value: ' ' },
	{ label: __('With Attachments'), value: 'true' },
	{ label: __('Without Attachments'), value: 'false' },
]

export const getReadStatusOptions = () => [
	{ label: __('All'), value: ' ' },
	{ label: __('Read'), value: 'true' },
	{ label: __('Unread'), value: 'false' },
]

export const FOLDER_ICON_MAP = {
	inbox: 'inbox',
	sent: 'send',
	trash: 'trash-2',
	junk: 'mail-warning',
	drafts: 'pencil-line',
	archive: 'archive',
	important: 'bookmark',
}

export const FOLDER_ICON_COLOR_MAP = {
	Blue: '!text-blue-500',
	Green: '!text-green-500',
	Amber: '!text-amber-500',
	Red: '!text-red-500',
	Purple: '!text-purple-500',
}

export const FOLDER_COLOR_MAP = {
	Gray: 'bg-surface-gray-8',
	Blue: 'bg-blue-500',
	Green: 'bg-green-500',
	Amber: 'bg-amber-500',
	Red: 'bg-red-500',
	Purple: 'bg-purple-500',
}

// The amber of a starred mail's star, wherever one is drawn.
//
// The mask/background half is not decoration: frappe-ui doesn't paint a lucide svg from its
// own geometry, it masks the element with a lucide-static copy of the glyph and paints
// through that with `background-color: currentColor`. The mask is the stroke-only outline,
// so there is no interior for `fill` to land in and the star renders as an amber ring.
// Clearing the mask hands rendering back to the real svg, whose fill and stroke then show —
// and the background has to go with it, or it would paint the whole icon box amber.
export const FLAGGED_STAR_STYLE =
	'fill: var(--ink-amber-6); color: var(--ink-amber-6); ' +
	'mask-image: none; -webkit-mask-image: none; background-color: transparent'

/**
 * The geometry of a Split View: a list column beside a reading pane.
 *
 * Shared because the mailbox lists (ThreadPane) and the screener draw the same split from separate
 * markup, and separate copies drift — the screener was still on a `w-1/3` / `w-2/3` fraction after
 * the lists moved to a viewport-relative column, so the two views disagreed about where the divide
 * sits. Anything that changes the proportions belongs here, not at one of the call sites.
 *
 * The column is a share of the VIEWPORT (vw, not a fraction of the row): the viewport doesn't change
 * when something else joins the row, so whatever does squeezes only the pane. The min-w floors keep
 * the list usable on cramped windows; past them the pane shrinks to its own floor and then the row
 * scrolls.
 */
export const SPLIT_LIST_CLASS = 'w-[28vw] min-w-64 shrink-0 border-r lg:min-w-80'

/** The pane takes whatever the column leaves, down to its own floor. */
export const SPLIT_PANE_CLASS = 'min-w-56 flex-1 lg:min-w-64'
