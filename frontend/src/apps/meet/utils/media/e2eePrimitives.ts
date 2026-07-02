// E2EE primitives: shared base64 codec, HKDF info-string helpers, and
// the security domain separator constants.
//
// The "meet-e2ee|" prefix is a security domain separator for HKDF
// calls. It lives in this one module. Any future Layer 3 epoch
// transition, chain-tip wipe event, or new key-derivation site must
// add a constant here, not introduce a new literal at a call site.
//
// The `meet-e2ee|envelope|<meetingId>|<keyVersion>` string is part of
// the signed envelope data, so changing the format is a wire-format
// change. Keep it in one place.

// --- Base64 codec ---

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function bytesFromBase64(b64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(b64);
	const buffer = new ArrayBuffer(binary.length);
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

// --- HKDF info strings (domain separators) ---

export const INFO_SENDER = (senderId: number, mediaType: string): string =>
	`meet-e2ee|sender|${senderId}|${mediaType}`;

export const INFO_FRAME = "meet-e2ee|frame";

export const INFO_AES = "meet-e2ee|aes";

export const INFO_FRAME_AT = (
	senderId: number,
	mediaType: string,
	generation: number,
): string => `meet-e2ee|frame|${senderId}|${mediaType}|${generation}`;

export const INFO_ENVELOPE = (meetingId: string, keyVersion: number): string =>
	`meet-e2ee|envelope|${meetingId}|${keyVersion}`;

export const INFO_ENVELOPE_CONTEXT = (
	meetingId: string,
	keyVersion: number,
): string => `|${meetingId}|${keyVersion}`;

export const INFO_CHAT = "meet-e2ee|chat";

export const INFO_POLL = "meet-e2ee|poll";

export function encodeInfo(s: string): Uint8Array<ArrayBuffer> {
	const src = new TextEncoder().encode(s);
	const out = new Uint8Array(src.length);
	out.set(src);
	return out;
}
