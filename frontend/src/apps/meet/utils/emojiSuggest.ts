import { gemoji } from "gemoji";

export type EmojiSuggestion = {
	name: string;
	emoji: string;
};

/** Flat name → emoji list (one entry per alias), matching frappe-ui emoji UX. */
const EMOJIS: EmojiSuggestion[] = gemoji.flatMap((entry) =>
	entry.names.map((name) => ({ name, emoji: entry.emoji })),
);

const RECENT_STORAGE_KEY = "meet-chat-recent-emojis";
const RECENT_LIMIT = 5;

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

function readRecentStore(): EmojiSuggestion[] {
	try {
		const raw = localStorage.getItem(RECENT_STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(item): item is EmojiSuggestion =>
					!!item &&
					typeof item === "object" &&
					typeof (item as EmojiSuggestion).name === "string" &&
					typeof (item as EmojiSuggestion).emoji === "string",
			)
			.slice(0, RECENT_LIMIT);
	} catch {
		return [];
	}
}

function writeRecentStore(items: EmojiSuggestion[]) {
	try {
		localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(items.slice(0, RECENT_LIMIT)));
	} catch {
		// private mode / quota — ignore
	}
}

/** Most recently used first, up to 5. */
export function getRecentEmojis(): EmojiSuggestion[] {
	return readRecentStore();
}

/** Push an emoji to the front of recents (deduped by glyph). */
export function rememberEmoji(item: EmojiSuggestion): void {
	const next = [
		{ name: item.name, emoji: item.emoji },
		...readRecentStore().filter((r) => r.emoji !== item.emoji),
	].slice(0, RECENT_LIMIT);
	writeRecentStore(next);
}

/** Substring filter + ranking: exact name → prefix → shorter names; cap at limit. */
function filterEmojis(query: string, limit: number): EmojiSuggestion[] {
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

/**
 * Empty query → recent emojis first, padded with default top matches (no glyph
 * duplicates) so the menu always has up to `limit` rows.
 * Non-empty → name filter + ranking; cap at 5.
 */
export function suggestEmojis(query: string, limit = RECENT_LIMIT): EmojiSuggestion[] {
	if (!query) {
		const recent = getRecentEmojis().slice(0, limit);
		if (recent.length === 0) return filterEmojis("", limit);
		if (recent.length >= limit) return recent;

		const used = new Set(recent.map((r) => r.emoji));
		// Fetch extra defaults so we still fill `limit` after dropping duplicates.
		const padding = filterEmojis("", limit * 4).filter((item) => !used.has(item.emoji));
		return [...recent, ...padding].slice(0, limit);
	}
	return filterEmojis(query, limit);
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

/** Test helper — clear recents without poking localStorage from callers. */
export function clearRecentEmojis(): void {
	try {
		localStorage.removeItem(RECENT_STORAGE_KEY);
	} catch {
		// ignore
	}
}
