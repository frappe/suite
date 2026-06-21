import { describe, expect, it } from "vitest";
import { generateMeetingSecret } from "../e2ee";
import {
	AES_GCM_TAG_SIZE,
	buildSignedFramePayload,
	chainTipToAESKey,
	decodeFrameHeader,
	deriveFrameKey,
	encodeFrameHeader,
	FRAME_HEADER_FIXED_SIZE,
	FRAME_HEADER_TOTAL,
	FRAME_MAGIC,
	getClearPrefixSize,
	hasFrameMagic,
	initSenderChain,
	MIN_SIGNED_ENCRYPTED_FRAME_SIZE,
	REPLAY_WINDOW,
} from "../frameCodec";

describe("frameCodec: constants", () => {
	it("exports the on-wire header shape (28-byte fixed + 64-byte signature)", () => {
		expect(FRAME_HEADER_FIXED_SIZE).toBe(28);
		expect(FRAME_HEADER_TOTAL).toBe(92);
		expect(FRAME_MAGIC.length).toBe(4);
		expect(FRAME_MAGIC[0]).toBe(0x4d); // M
		expect(FRAME_MAGIC[1]).toBe(0x45); // E
		expect(FRAME_MAGIC[2]).toBe(0x32); // 2
		expect(FRAME_MAGIC[3]).toBe(0x45); // E
	});

	it("MIN_SIGNED_ENCRYPTED_FRAME_SIZE accounts for magic + header + tag + 1 byte of plaintext", () => {
		expect(MIN_SIGNED_ENCRYPTED_FRAME_SIZE).toBe(
			FRAME_MAGIC.length + FRAME_HEADER_TOTAL + AES_GCM_TAG_SIZE + 1,
		);
	});

	it("REPLAY_WINDOW is the conservative main-thread default (3); worker overrides to 100", () => {
		expect(REPLAY_WINDOW).toBe(3);
	});
});

describe("frameCodec: header encode/decode", () => {
	it("round-trips senderId, generation, keyVersion, epochNumber, and iv (keyframe)", () => {
		const header = {
			senderId: 0x12345678,
			generation: 42,
			frameType: "key" as const,
			keyVersion: 7,
			epochNumber: 3,
			iv: new Uint8Array(12).fill(0xab),
		};
		const encoded = encodeFrameHeader(header);
		expect(encoded.length).toBe(FRAME_HEADER_FIXED_SIZE);
		const decoded = decodeFrameHeader(encoded);
		expect(decoded).not.toBeNull();
		expect(decoded?.senderId).toBe(0x12345678);
		expect(decoded?.generation).toBe(42);
		expect(decoded?.frameType).toBe("key");
		expect(decoded?.keyVersion).toBe(7);
		expect(decoded?.epochNumber).toBe(3);
		expect(Array.from(decoded?.iv ?? [])).toEqual(
			Array.from(new Uint8Array(12).fill(0xab)),
		);
	});

	it("encodes a delta frame type by leaving the keyframe bit clear", () => {
		const header = {
			senderId: 1,
			generation: 7,
			frameType: "delta" as const,
			keyVersion: 1,
			epochNumber: 1,
			iv: new Uint8Array(12),
		};
		const encoded = encodeFrameHeader(header);
		const decoded = decodeFrameHeader(encoded);
		expect(decoded?.frameType).toBe("delta");
		expect(decoded?.generation).toBe(7);
	});

	it("rejects frames shorter than 28 bytes", () => {
		expect(decodeFrameHeader(new Uint8Array(27))).toBeNull();
	});

	it("uses little-endian byte order for the four uint32 fields", () => {
		const header = {
			senderId: 1,
			generation: 0,
			keyVersion: 0,
			epochNumber: 2,
			iv: new Uint8Array(12),
		};
		const encoded = encodeFrameHeader(header);
		const view = new DataView(encoded.buffer, encoded.byteOffset, 16);
		expect(view.getUint32(0, true)).toBe(1);
		expect(view.getUint32(12, true)).toBe(2);
	});
});

describe("frameCodec: clear-prefix and magic detection", () => {
	it("getClearPrefixSize returns 1 for video, 0 for audio", () => {
		expect(getClearPrefixSize("video")).toBe(1);
		expect(getClearPrefixSize("audio")).toBe(0);
	});

	it("hasFrameMagic returns true iff the magic bytes appear at the offset", () => {
		const data = new Uint8Array([0, 0, 0, 0, ...FRAME_MAGIC, 0, 0]);
		expect(hasFrameMagic(data, 4)).toBe(true);
		expect(hasFrameMagic(data, 0)).toBe(false);
		expect(hasFrameMagic(data, 5)).toBe(false);
	});

	it("hasFrameMagic returns false for short buffers", () => {
		expect(hasFrameMagic(new Uint8Array(3), 0)).toBe(false);
	});
});

describe("frameCodec: buildSignedFramePayload", () => {
	it("concatenates headerFixed || clearPrefix || frameMagic || ciphertext in order", () => {
		const headerFixed = new Uint8Array([1, 2, 3]);
		const clearPrefix = new Uint8Array([4, 5]);
		const frameMagic = new Uint8Array([6]);
		const ciphertext = new Uint8Array([7, 8, 9]);
		const out = buildSignedFramePayload(
			headerFixed as Uint8Array<ArrayBuffer>,
			clearPrefix as Uint8Array<ArrayBuffer>,
			frameMagic as Uint8Array<ArrayBuffer>,
			ciphertext as Uint8Array<ArrayBuffer>,
		);
		expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});

describe("frameCodec: chain key derivations (pure crypto smoke)", () => {
	it("deriveFrameKey produces a usable AES-GCM key", async () => {
		const secret = await generateMeetingSecret();
		const key = await deriveFrameKey(secret, 7, "video", 0);
		expect(key.algorithm.name).toBe("AES-GCM");
		expect(key.usages).toContain("encrypt");
	});

	it("initSenderChain produces a non-zero chain tip", async () => {
		const secret = await generateMeetingSecret();
		const tip = await initSenderChain(secret, 1, "video");
		expect(tip.length).toBe(32);
		expect(tip.some((b) => b !== 0)).toBe(true);
	});

	it("chainTipToAESKey produces a usable AES-GCM key", async () => {
		const secret = await generateMeetingSecret();
		const tip = await initSenderChain(secret, 1, "video");
		const key = await chainTipToAESKey(tip);
		expect(key.algorithm.name).toBe("AES-GCM");
	});
});
