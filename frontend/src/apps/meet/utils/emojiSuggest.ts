import { gemoji } from "gemoji";

export type EmojiSuggestion = {
	name: string;
	emoji: string;
};

/** Flat name → emoji list (one entry per alias), matching frappe-ui emoji UX. */
const EMOJIS: EmojiSuggestion[] = gemoji.flatMap((entry) =>
	entry.names.map((name) => ({ name, emoji: entry.emoji })),
);

/**
 * Match a trailing `:query` before the caret (same trigger as frappe-ui TipTap emoji).
 * Query is letters, digits, `_`, `+`, `-` only so `http://` never opens the menu.
 */
const COLON_QUERY = /:([a-zA-Z0-9_+-]*)$/;

export function findColonQuery(
	text: string,
	caret: number,
): { start: number; query: string } | null {
	const before = text.slice(0, caret);
	const match = before.match(COLON_QUERY);
	if (!match || match.index === undefined) return null;
	return { start: match.index, query: match[1] };
}

/**
 * Substring filter + ranking used by frappe-ui emoji extension:
 * exact name → prefix → shorter names; cap at 5.
 */
export function suggestEmojis(query: string, limit = 5): EmojiSuggestion[] {
	const needle = query.toLowerCase();
	return EMOJIS.filter((item) => item.name.toLowerCase().includes(needle))
		.sort((a, b) => {
			const aName = a.name.toLowerCase();
			const bName = b.name.toLowerCase();
			if (aName === needle && bName !== needle) return -1;
			if (bName === needle && aName !== needle) return 1;
			if (aName.startsWith(needle) && !bName.startsWith(needle)) return -1;
			if (bName.startsWith(needle) && !aName.startsWith(needle)) return 1;
			return aName.length - bName.length;
		})
		.slice(0, limit);
}

export function insertEmojiAtQuery(
	text: string,
	caret: number,
	queryStart: number,
	emoji: string,
): { text: string; caret: number } {
	const next = text.slice(0, queryStart) + emoji + text.slice(caret);
	const nextCaret = queryStart + emoji.length;
	return { text: next, caret: nextCaret };
}
