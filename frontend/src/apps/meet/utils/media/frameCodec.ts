// E2EE frame codec: shared per-frame encode/decode/sign/verify
// routines, frame-header constants, and chain-key derivations.
//
// Both the main-thread `TransformStream` (in e2ee.ts) and the
// RTCRtpScriptTransform worker (in e2eeTransformWorker.ts) import
// from this module so the cryptographic invariants — header size,
// signature scheme, domain separators, replay window — are
// byte-for-byte identical.
//
// REPLAY_WINDOW asymmetry: the main thread uses a short window (3)
// to keep the hot path lean; the worker uses a longer window (100)
// because it has more headroom. The default exported value is the
// main-thread conservative value; the worker overrides locally.
// The intent is deliberate, not a bug.

import {
	encodeInfo,
	INFO_AES,
	INFO_FRAME,
	INFO_FRAME_AT,
	INFO_SENDER,
} from "./e2eePrimitives";

export const FRAME_HEADER_FIXED_SIZE = 28;
const FRAME_SIGNATURE_SIZE = 64;
export const FRAME_HEADER_TOTAL =
	FRAME_HEADER_FIXED_SIZE + FRAME_SIGNATURE_SIZE;
export const AES_GCM_TAG_SIZE = 16;
const MIN_FRAME_PLAINTEXT_SIZE = 1;
export const FRAME_MAGIC = new Uint8Array([0x4d, 0x45, 0x32, 0x45]); // ME2E
export const EMPTY_FRAME_MAGIC = new Uint8Array(0);
export const MIN_SIGNED_ENCRYPTED_FRAME_SIZE =
	FRAME_MAGIC.byteLength +
	FRAME_HEADER_TOTAL +
	AES_GCM_TAG_SIZE +
	MIN_FRAME_PLAINTEXT_SIZE;
const FRAME_GENERATION_KEYFRAME_FLAG = 0x80000000;
const FRAME_GENERATION_MASK = 0x7fffffff;
const VIDEO_CLEAR_PREFIX_SIZE = 1;
export const REPLAY_WINDOW = 3;

type E2EEFrameHeader = {
	senderId: number;
	generation: number;
	frameType?: string;
	keyVersion: number;
	epochNumber: number;
	iv: Uint8Array<ArrayBuffer>;
};

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}
	return subtle;
}

function concatBytes(
	parts: Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
	const total = parts.reduce((n, p) => n + p.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.byteLength;
	}
	return out;
}

async function hkdfBits(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	const bits = await subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
		baseKey,
		256,
	);
	return new Uint8Array(bits);
}

async function hkdfToAESKey(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveKey",
	]);
	return subtle.deriveKey(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export function encodeFrameHeader(
	header: E2EEFrameHeader,
): Uint8Array<ArrayBuffer> {
	const encoded = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
	const view = new DataView(encoded.buffer);
	const generation =
		(header.generation & FRAME_GENERATION_MASK) |
		(header.frameType === "key" ? FRAME_GENERATION_KEYFRAME_FLAG : 0);
	view.setUint32(0, header.senderId, true);
	view.setUint32(4, generation, true);
	view.setUint32(8, header.keyVersion, true);
	view.setUint32(12, header.epochNumber, true);
	encoded.set(header.iv.subarray(0, 12), 16);
	return encoded;
}

export function decodeFrameHeader(data: Uint8Array): E2EEFrameHeader | null {
	if (data.length < FRAME_HEADER_FIXED_SIZE) {
		return null;
	}
	const view = new DataView(
		data.buffer,
		data.byteOffset,
		FRAME_HEADER_FIXED_SIZE,
	);
	const iv = new Uint8Array(12);
	iv.set(data.subarray(16, 28));
	const encodedGeneration = view.getUint32(4, true);
	return {
		senderId: view.getUint32(0, true),
		generation: encodedGeneration & FRAME_GENERATION_MASK,
		frameType:
			(encodedGeneration & FRAME_GENERATION_KEYFRAME_FLAG) !== 0
				? "key"
				: "delta",
		keyVersion: view.getUint32(8, true),
		epochNumber: view.getUint32(12, true),
		iv,
	};
}

export function buildSignedFramePayload(
	headerFixed: Uint8Array<ArrayBuffer>,
	clearPrefix: Uint8Array<ArrayBuffer>,
	frameMagic: Uint8Array<ArrayBuffer>,
	ciphertext: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
	return concatBytes([headerFixed, clearPrefix, frameMagic, ciphertext]);
}

export function hasFrameMagic(data: Uint8Array, offset: number): boolean {
	if (data.length < offset + FRAME_MAGIC.byteLength) return false;
	for (let i = 0; i < FRAME_MAGIC.byteLength; i += 1) {
		if (data[offset + i] !== FRAME_MAGIC[i]) return false;
	}
	return true;
}

export function getClearPrefixSize(mediaType: string): number {
	return mediaType === "video" ? VIDEO_CLEAR_PREFIX_SIZE : 0;
}

export function getClearPrefix(
	data: ArrayBuffer,
	prefixSize: number,
): Uint8Array<ArrayBuffer> {
	if (prefixSize === 0) return new Uint8Array(0);
	const source = new Uint8Array(data);
	const prefix = new Uint8Array(Math.min(prefixSize, source.byteLength));
	prefix.set(source.subarray(0, prefix.byteLength));
	return prefix;
}

export function initSenderChain(
	meetingSecret: Uint8Array<ArrayBuffer>,
	senderId: number,
	mediaType: string,
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(meetingSecret, encodeInfo(INFO_SENDER(senderId, mediaType)));
}

export function advanceChain(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return hkdfBits(chainTip, encodeInfo(INFO_FRAME));
}

export function chainTipToAESKey(
	chainTip: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
	return hkdfToAESKey(chainTip, encodeInfo(INFO_AES));
}

export function deriveFrameKey(
	meetingSecret: Uint8Array<ArrayBuffer>,
	senderId: number,
	mediaType: string,
	generation: number,
): Promise<CryptoKey> {
	return hkdfToAESKey(
		meetingSecret,
		encodeInfo(INFO_FRAME_AT(senderId, mediaType, generation)),
	);
}
