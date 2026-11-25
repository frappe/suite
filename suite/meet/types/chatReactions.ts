import type { ChatMessage } from './index';

export const MAX_RETAINED_CHAT_MESSAGES = 200;

export const QUICK_CHAT_REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '👏'] as const;

export const MAX_CHAT_REACTIONS_PER_MESSAGE = 32;

const emojiUnit = String.raw`(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})\uFE0F?\p{Emoji_Modifier}?`;
const emojiSequence = new RegExp(
	String.raw`^(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|\u{1F3F4}[\u{E0061}-\u{E007A}]{2,7}\u{E007F}|${emojiUnit}(?:\u200D${emojiUnit})*)$`,
	'u',
);

export function isChatReaction(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 32 && value === value.trim() && emojiSequence.test(value);
}

export interface ChatReactionRequest {
	messageId: string;
	emoji: string;
	active: boolean;
}

export interface ChatReactionsUpdated {
	messageId: string;
	reactions: { emoji: string; userIds: string[] }[];
}


export interface ChatSnapshot {
	messages: ChatMessage[];
	reactions: ChatReactionsUpdated[];
	pinnedId: string | null;
	pinnedRetained: boolean;
	hostOnlyChat: boolean;
}
