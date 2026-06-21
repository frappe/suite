import { describe, expect, it } from "vitest";

import {
	bufferToBase64,
	bytesFromBase64,
	encodeInfo,
	INFO_AES,
	INFO_CHAT,
	INFO_ENVELOPE,
	INFO_ENVELOPE_CONTEXT,
	INFO_FRAME,
	INFO_FRAME_AT,
	INFO_SENDER,
} from "../e2eePrimitives";

describe("e2eePrimitives: base64 codec", () => {
	it("round-trips a Uint8Array through bufferToBase64 and bytesFromBase64", () => {
		const original = new Uint8Array([0, 1, 2, 3, 250, 251, 255]);
		const encoded = bufferToBase64(original);
		const decoded = bytesFromBase64(encoded);
		expect(Array.from(decoded)).toEqual(Array.from(original));
	});

	it("accepts ArrayBuffer in addition to Uint8Array", () => {
		const buf = new Uint8Array([10, 20, 30]).buffer;
		const encoded = bufferToBase64(buf);
		const decoded = bytesFromBase64(encoded);
		expect(Array.from(decoded)).toEqual([10, 20, 30]);
	});

	it("bytesFromBase64 returns a Uint8Array backed by ArrayBuffer (not SharedArrayBuffer)", () => {
		const original = new Uint8Array([0xab, 0xcd, 0xef]);
		const decoded = bytesFromBase64(bufferToBase64(original));
		expect(decoded).toBeInstanceOf(Uint8Array);
		expect(decoded.byteLength).toBe(3);
		expect(decoded.buffer).toBeInstanceOf(ArrayBuffer);
	});

	it("throws on malformed base64", () => {
		expect(() => bytesFromBase64("not!valid!base64!@")).toThrow();
	});
});

describe("e2eePrimitives: HKDF info-string domain separators", () => {
	it("all info strings share the 'meet-e2ee|' security prefix", () => {
		expect(INFO_FRAME.startsWith("meet-e2ee|")).toBe(true);
		expect(INFO_AES.startsWith("meet-e2ee|")).toBe(true);
		expect(INFO_CHAT.startsWith("meet-e2ee|")).toBe(true);
	});

	it("INFO_SENDER encodes the senderId and mediaType into the string", () => {
		expect(INFO_SENDER(7, "video")).toBe("meet-e2ee|sender|7|video");
		expect(INFO_SENDER(42, "audio")).toBe("meet-e2ee|sender|42|audio");
	});

	it("INFO_FRAME_AT encodes senderId, mediaType, and generation", () => {
		expect(INFO_FRAME_AT(3, "video", 17)).toBe("meet-e2ee|frame|3|video|17");
	});

	it("INFO_ENVELOPE encodes meetingId and keyVersion", () => {
		expect(INFO_ENVELOPE("vscl-sabe-ykvp", 1)).toBe(
			"meet-e2ee|envelope|vscl-sabe-ykvp|1",
		);
	});

	it("INFO_ENVELOPE_CONTEXT uses a leading pipe (signed-data suffix, not HKDF info)", () => {
		expect(INFO_ENVELOPE_CONTEXT("vscl-sabe-ykvp", 1)).toBe(
			"|vscl-sabe-ykvp|1",
		);
		expect(INFO_ENVELOPE_CONTEXT("vscl-sabe-ykvp", 1)).not.toContain(
			"meet-e2ee",
		);
	});

	it("encodeInfo returns a Uint8Array copy of the UTF-8 bytes (not the TextEncoder Uint8Array's underlying buffer)", () => {
		const encoded = encodeInfo(INFO_SENDER(1, "video"));
		expect(encoded).toBeInstanceOf(Uint8Array);
		const expected = new TextEncoder().encode(INFO_SENDER(1, "video"));
		expect(Array.from(encoded)).toEqual(Array.from(expected));
	});
});
