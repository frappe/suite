export type ChatMessageToken =
	| { type: "text"; text: string }
	| { type: "link"; text: string; url: string };

const URL_REGEX = /(https?:\/\/[^\s]+)/g;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export function tokenizeChatMessage(message: string): ChatMessageToken[] {
	const tokens: ChatMessageToken[] = [];
	let cursor = 0;
	for (const match of message.matchAll(URL_REGEX)) {
		const start = match.index ?? 0;
		if (start > cursor) {
			tokens.push({ type: "text", text: message.slice(cursor, start) });
		}
		const raw = match[0];
		tokens.push(toLinkToken(raw));
		cursor = start + raw.length;
	}
	if (cursor < message.length) {
		tokens.push({ type: "text", text: message.slice(cursor) });
	}
	return tokens;
}

function toLinkToken(raw: string): ChatMessageToken {
	try {
		const parsed = new URL(raw);
		if (ALLOWED_SCHEMES.has(parsed.protocol)) {
			return { type: "link", text: raw, url: parsed.href };
		}
	} catch {
		// fall through to text
	}
	return { type: "text", text: raw };
}
