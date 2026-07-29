/**
 * The selection a keyboard range spans, computed from its two ends rather than stepped into existence.
 *
 * Shift+arrow selects a range: one end is the anchor (the row the cursor sat on when the range began),
 * the other is the row the cursor is on now, and everything between them is in. Recomputing the whole
 * range on every step is what makes it symmetric — walking back the way you came drops exactly the row
 * you left, where flipping rows one at a time on the way past unselected the row being left *and* the
 * row being entered.
 *
 * Both ends are given as thread runs, not single ids, because a row can stand for several threads — a
 * stack for its members, a date header for its day. Those runs are contiguous in `order` (the loaded
 * threads in list order), so the range is simply the slice between the outermost indexes of the two.
 *
 * `base` is whatever was already selected when the range began. It rides through untouched, so
 * shrinking the range gives back only what the range itself selected.
 */
export const rangeSelection = (
	order: string[],
	anchorIDs: string[],
	cursorIDs: string[],
	base: string[] = [],
): string[] => {
	// A row can outlive the loaded list (a mutation dropped it, a refresh replaced the window); ignore
	// such an end rather than letting indexOf's -1 stretch the range to the top of the list.
	const indexes = [...anchorIDs, ...cursorIDs]
		.map((id) => order.indexOf(id))
		.filter((index) => index !== -1)
	if (!indexes.length) return [...new Set(base)]

	const range = order.slice(Math.min(...indexes), Math.max(...indexes) + 1)
	return [...new Set([...base, ...range])]
}
