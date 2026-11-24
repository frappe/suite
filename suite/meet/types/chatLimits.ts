export const MAX_CHAT_TEXT_BYTES = 32 * 1024;
export const CHAT_TOO_LONG_ERROR =
	'Messages can be up to 32 KiB. Shorten your message and try again.';
export const E2EE_CHAT_PREFIX = 'e2ee:';

// AES-GCM adds a 12-byte IV and a 16-byte authentication tag before Base64 encoding.
export const MAX_ENCRYPTED_CHAT_LENGTH =
	E2EE_CHAT_PREFIX.length + 4 * Math.ceil((MAX_CHAT_TEXT_BYTES + 12 + 16) / 3);
