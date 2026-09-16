// The phone's bottom bars and sheets are one design across the suite's apps, so their
// class recipes live here once rather than as copies that drift apart.

/**
 * A bar tab. Active and inactive differ in ink (9 vs 5) and in weight, so the active tab
 * pops without the rest going faint. Inactive sits at 5, not the 4 used for meta text
 * elsewhere: at 4 the whole bar read as disabled rather than as tappable tabs.
 */
export const tabClass = (active: boolean) =>
	[
		'flex flex-1 flex-col items-center justify-center gap-1',
		active ? 'text-ink-gray-9' : 'text-ink-gray-5',
	].join(' ')

/** A tab's glyph, a stroke heavier when active. */
export const iconClass = (active: boolean) =>
	['h-6 w-6 shrink-0', active ? '[stroke-width:1.75]' : '[stroke-width:1.5]'].join(' ')

/**
 * A tab's label. 11px sits below the type scale's floor (text-xs is 12), so it is spelled
 * out, along with the 0.02em the scale's own tokens carry and an arbitrary size does not.
 */
export const labelClass = (active: boolean) =>
	[
		'text-[11px] tracking-[0.02em] !leading-3',
		active ? '!font-semibold' : '!font-medium',
	].join(' ')

/** A row in a picker sheet (folders, views, apps), tinted for the one you are on. */
export const sheetRowClass = (active: boolean) =>
	[
		'flex w-full items-center gap-3 rounded-6 px-3 py-2.5 text-base text-ink-gray-8',
		active ? 'bg-surface-gray-2 !font-semibold' : 'active:bg-surface-gray-1',
	].join(' ')
