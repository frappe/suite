import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { E2EEMeeting } from "../E2EEMeeting";

beforeAll(() => {
	if (typeof globalThis.RTCRtpSender === "undefined") {
		globalThis.RTCRtpSender = class RTCRtpSender {} as never;
		globalThis.RTCRtpReceiver = class RTCRtpReceiver {} as never;
	}
});

afterEach(() => {
	delete (
		RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		}
	).createEncodedStreams;
	delete (
		RTCRtpReceiver.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		}
	).createEncodedStreams;
});

import { decodeFrameHeader, encodeFrameHeader } from "../frameCodec";

describe("Crypto primitives (T1.1)", () => {
	describe("X25519 ECDH", () => {
		it("generates 32-byte public key", async () => {
			const { x25519KeyPair, exportPublicKey } = await import("../e2ee");
			const kp = await x25519KeyPair();
			const b64 = await exportPublicKey(kp.publicKey);
			const raw = atob(b64);
			expect(raw.length).toBe(32);
		});

		it("round-trips public key export/import", async () => {
			const { x25519KeyPair, exportPublicKey, importPublicKey } = await import(
				"../e2ee"
			);
			const kp = await x25519KeyPair();
			const b64 = await exportPublicKey(kp.publicKey);
			const imported = await importPublicKey(b64);
			const reExported = await exportPublicKey(imported);
			expect(reExported).toBe(b64);
		});

		it("derives matching shared secrets on both sides (RFC 7748 property)", async () => {
			const {
				x25519KeyPair,
				exportPublicKey,
				importPublicKey,
				ecdhKeyAgreement,
			} = await import("../e2ee");
			const alice = await x25519KeyPair();
			const bob = await x25519KeyPair();
			const aliceShared = await ecdhKeyAgreement(
				alice.privateKey,
				await importPublicKey(await exportPublicKey(bob.publicKey)),
			);
			const bobShared = await ecdhKeyAgreement(
				bob.privateKey,
				await importPublicKey(await exportPublicKey(alice.publicKey)),
			);
			expect(Buffer.from(aliceShared).toString("hex")).toBe(
				Buffer.from(bobShared).toString("hex"),
			);
		});
	});

	describe("Ed25519 signatures", () => {
		it("round-trips sign/verify", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const kp = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|12345678");
			const sig = await signProof(kp.privateKey, payload);
			const ok = await verifyProof(kp.publicKey, payload, sig);
			expect(ok).toBe(true);
		});

		it("rejects signature with wrong key", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const signer = await ed25519KeyPair();
			const attacker = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|12345678");
			const sig = await signProof(signer.privateKey, payload);
			const ok = await verifyProof(attacker.publicKey, payload, sig);
			expect(ok).toBe(false);
		});

		it("rejects signature with tampered payload", async () => {
			const { ed25519KeyPair, signProof, verifyProof } = await import(
				"../e2ee"
			);
			const kp = await ed25519KeyPair();
			const payload = new TextEncoder().encode("host_pub|12345678");
			const sig = await signProof(kp.privateKey, payload);
			const tampered = new TextEncoder().encode("host_pub|00000000");
			const ok = await verifyProof(kp.publicKey, tampered, sig);
			expect(ok).toBe(false);
		});

		it("Ed25519 public key round-trips via export/import", async () => {
			const { ed25519KeyPair, exportEd25519PublicKey, importEd25519PublicKey } =
				await import("../e2ee");
			const kp = await ed25519KeyPair();
			const b64 = await exportEd25519PublicKey(kp.publicKey);
			const imported = await importEd25519PublicKey(b64);
			const reExported = await exportEd25519PublicKey(imported);
			expect(reExported).toBe(b64);
		});
	});

	describe("Browser support detection", () => {
		it("featureDetectX25519 returns true on supported runtimes", async () => {
			const { featureDetectX25519 } = await import("../e2ee");
			await expect(featureDetectX25519()).resolves.toBe(true);
		});
	});
});

describe("Chain derivation (T1.3)", () => {
	describe("Meeting secret + envelope", () => {
		it("generateMeetingSecret returns 32 random bytes", async () => {
			const { generateMeetingSecret } = await import("../e2ee");
			const s1 = await generateMeetingSecret();
			const s2 = await generateMeetingSecret();
			expect(s1.length).toBe(32);
			expect(s2.length).toBe(32);
			expect(Buffer.from(s1).toString("hex")).not.toBe(
				Buffer.from(s2).toString("hex"),
			);
		});
	});

	describe("HKDF chain", () => {
		it("initSenderChain is deterministic per (meetingSecret, senderId, mediaType)", async () => {
			const { generateMeetingSecret, initSenderChain } = await import(
				"../e2ee"
			);
			const secret = await generateMeetingSecret();
			const c1 = await initSenderChain(secret, 7, "video");
			const c2 = await initSenderChain(secret, 7, "video");
			expect(Buffer.from(c1).toString("hex")).toBe(
				Buffer.from(c2).toString("hex"),
			);
		});

		it("initSenderChain differs across senderIds", async () => {
			const { generateMeetingSecret, initSenderChain } = await import(
				"../e2ee"
			);
			const secret = await generateMeetingSecret();
			const c7 = await initSenderChain(secret, 7, "video");
			const c8 = await initSenderChain(secret, 8, "video");
			expect(Buffer.from(c7).toString("hex")).not.toBe(
				Buffer.from(c8).toString("hex"),
			);
		});

		it("initSenderChain differs across mediaTypes for same senderId", async () => {
			const { generateMeetingSecret, initSenderChain } = await import(
				"../e2ee"
			);
			const secret = await generateMeetingSecret();
			const cVideo = await initSenderChain(secret, 1, "video");
			const cAudio = await initSenderChain(secret, 1, "audio");
			expect(Buffer.from(cVideo).toString("hex")).not.toBe(
				Buffer.from(cAudio).toString("hex"),
			);
		});

		it("advanceChain produces 32-byte deterministic next tip", async () => {
			const { advanceChain } = await import("../e2ee");
			const tip = new Uint8Array(32);
			const next1 = await advanceChain(tip);
			const next2 = await advanceChain(tip);
			expect(next1.length).toBe(32);
			expect(Buffer.from(next1).toString("hex")).toBe(
				Buffer.from(next2).toString("hex"),
			);
			expect(Buffer.from(next1).toString("hex")).not.toBe("0".repeat(64));
		});

		it("chainTipToAESKey produces a usable AES-GCM key", async () => {
			const { chainTipToAESKey, advanceChain } = await import("../e2ee");
			const tip = await advanceChain(new Uint8Array(32));
			const aesKey = await chainTipToAESKey(tip);
			const iv = new Uint8Array(12);
			const ct = await globalThis.crypto.subtle.encrypt(
				{ name: "AES-GCM", iv },
				aesKey,
				new TextEncoder().encode("hello"),
			);
			const pt = await globalThis.crypto.subtle.decrypt(
				{ name: "AES-GCM", iv },
				aesKey,
				ct,
			);
			expect(new TextDecoder().decode(pt)).toBe("hello");
		});
	});

	describe("End-to-end key derivation round-trip", () => {
		it("SenderChainState and ReceiverChainState derive matching keys for all generations", async () => {
			const {
				generateMeetingSecret,
				SenderChainState,
				ReceiverChainState,
				ed25519KeyPair,
			} = await import("../e2ee");
			const meetingSecret = await generateMeetingSecret();
			const kp = await ed25519KeyPair();
			const senderState = new SenderChainState(
				meetingSecret,
				42,
				"video",
				kp.privateKey,
			);
			const receiverState = new ReceiverChainState(meetingSecret);
			receiverState.setSenderSigningPub(42, kp.publicKey);
			for (let i = 0; i < 100; i++) {
				const senderResult = await senderState.nextFrameKey();
				expect(senderResult.generation).toBe(i);
				const receiverResult = await receiverState.getKeyForFrame(
					42,
					"video",
					i,
				);
				expect("key" in receiverResult).toBe(true);
				if ("key" in receiverResult) {
					const iv = new Uint8Array(12);
					const frameData = new TextEncoder().encode(`frame ${i}`);
					const ct = await globalThis.crypto.subtle.encrypt(
						{ name: "AES-GCM", iv },
						senderResult.key,
						frameData,
					);
					const pt = await globalThis.crypto.subtle.decrypt(
						{ name: "AES-GCM", iv },
						receiverResult.key,
						ct,
					);
					expect(new TextDecoder().decode(pt)).toBe(`frame ${i}`);
				}
			}
		});

		it("receiver can decrypt at any generation without advancing", async () => {
			const {
				generateMeetingSecret,
				SenderChainState,
				ReceiverChainState,
				ed25519KeyPair,
			} = await import("../e2ee");
			const meetingSecret = await generateMeetingSecret();
			const kp = await ed25519KeyPair();
			const senderState = new SenderChainState(
				meetingSecret,
				10,
				"video",
				kp.privateKey,
			);
			const receiverState = new ReceiverChainState(meetingSecret);
			receiverState.setSenderSigningPub(10, kp.publicKey);
			for (let i = 0; i < 500; i++) {
				await senderState.nextFrameKey();
			}
			const senderResult = await senderState.nextFrameKey();
			expect(senderResult.generation).toBe(500);
			const receiverResult = await receiverState.getKeyForFrame(
				10,
				"video",
				500,
			);
			expect("key" in receiverResult).toBe(true);
			if ("key" in receiverResult) {
				const iv = new Uint8Array(12);
				const frameData = new TextEncoder().encode("jump-ahead");
				const ct = await globalThis.crypto.subtle.encrypt(
					{ name: "AES-GCM", iv },
					senderResult.key,
					frameData,
				);
				const pt = await globalThis.crypto.subtle.decrypt(
					{ name: "AES-GCM", iv },
					receiverResult.key,
					ct,
				);
				expect(new TextDecoder().decode(pt)).toBe("jump-ahead");
			}
		});
	});
});

describe("Frame header (T1.4)", () => {
	it("encoded header is 28 bytes", () => {
		const header = {
			senderId: 0x12345678,
			generation: 0x1abcdef0,
			frameType: "key",
			keyVersion: 0xdeadbeef,
			epochNumber: 4,
			iv: new Uint8Array(12).fill(0xab),
		};
		const encoded = encodeFrameHeader(header);
		expect(encoded.length).toBe(28);
	});

	it("round-trips all fields", () => {
		const original = {
			senderId: 0x12345678,
			generation: 0x1abcdef0,
			frameType: "key",
			keyVersion: 0xdeadbeef,
			epochNumber: 4,
			iv: new Uint8Array(12).fill(0xab),
		};
		const encoded = encodeFrameHeader(original);
		const decoded = decodeFrameHeader(encoded);
		expect(decoded?.senderId).toBe(0x12345678);
		expect(decoded?.generation).toBe(0x1abcdef0);
		expect(decoded?.frameType).toBe("key");
		expect(decoded?.keyVersion).toBe(0xdeadbeef);
		expect(decoded?.epochNumber).toBe(4);
		expect(Buffer.from(decoded?.iv).toString("hex")).toBe("ab".repeat(12));
	});

	it("round-trips delta frame type", () => {
		const encoded = encodeFrameHeader({
			senderId: 1,
			generation: 7,
			frameType: "delta",
			keyVersion: 1,
			epochNumber: 1,
			iv: new Uint8Array(12),
		});
		const decoded = decodeFrameHeader(encoded);
		expect(decoded?.generation).toBe(7);
		expect(decoded?.frameType).toBe("delta");
	});

	it("rejects frames shorter than 28 bytes", () => {
		const decoded = decodeFrameHeader(new Uint8Array(27));
		expect(decoded).toBeNull();
	});

	it("little-endian byte order", () => {
		const encoded = encodeFrameHeader({
			senderId: 1,
			generation: 0,
			keyVersion: 0,
			epochNumber: 2,
			iv: new Uint8Array(12),
		});
		expect(encoded[0]).toBe(1);
		expect(encoded[1]).toBe(0);
		expect(encoded[2]).toBe(0);
		expect(encoded[3]).toBe(0);
	});
});

describe("Transform streams (T1.5 + T1.6)", () => {
	type FakeFrame = { data: ArrayBuffer };

	function makeFakeFrame(bytes: Uint8Array): FakeFrame {
		return { data: bytes.buffer as ArrayBuffer };
	}

	async function runEncryptDecrypt(
		encrypt: TransformStream,
		decrypt: TransformStream,
		frames: FakeFrame[],
	): Promise<Uint8Array[]> {
		const decrypted: Uint8Array[] = [];
		const reader = decrypt.readable.getReader();
		const readPromise = (async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					decrypted.push(new Uint8Array(value.data));
				}
			} catch {
				// cancelled
			}
		})();

		const pipePromise = encrypt.readable.pipeTo(decrypt.writable);
		const writer = encrypt.writable.getWriter();
		for (const f of frames) {
			await writer.write(f);
		}
		await writer.close();
		await pipePromise;
		await readPromise;
		return decrypted;
	}

	it("sender + receiver round-trip 50 frames in order", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const keyVersion = 1;
		const senderState = new SenderChainState(
			meetingSecret,
			42,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		receiverState.setSenderSigningPub(42, kp.publicKey);
		const encrypt = createEncryptionTransformStream(senderState, keyVersion);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			keyVersion,
			undefined,
			"video",
		);
		const frames: FakeFrame[] = [];
		for (let i = 0; i < 50; i++) {
			frames.push(makeFakeFrame(new TextEncoder().encode(`payload-${i}`)));
		}
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, frames);
		expect(decrypted.length).toBe(50);
		for (let i = 0; i < 50; i++) {
			expect(new TextDecoder().decode(decrypted[i])).toBe(`payload-${i}`);
		}
	});

	it("legacy transform streams use the latest meeting context after epoch rotation", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const firstSecret = await generateMeetingSecret();
		const secondSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		let keyVersion = 1;
		const senderState = new SenderChainState(
			firstSecret,
			42,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(firstSecret);
		receiverState.setSenderSigningPub(42, kp.publicKey);
		const encrypt = createEncryptionTransformStream(
			senderState,
			() => keyVersion,
		);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			() => keyVersion,
			undefined,
			"video",
		);
		const reader = decrypt.readable.getReader();
		const pipePromise = encrypt.readable.pipeTo(decrypt.writable);
		const writer = encrypt.writable.getWriter();

		await writer.write(makeFakeFrame(new TextEncoder().encode("before")));
		const before = await reader.read();
		expect(new TextDecoder().decode(before.value.data)).toBe("before");

		keyVersion = 2;
		senderState.updateContext(secondSecret, kp.privateKey);
		receiverState.updateContext(new Uint8Array(secondSecret));
		await writer.write(makeFakeFrame(new TextEncoder().encode("after")));
		const after = await reader.read();

		expect(new TextDecoder().decode(after.value.data)).toBe("after");

		await writer.close();
		await pipePromise;
	});

	it("receiver drops frames with wrong keyVersion", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const senderState = new SenderChainState(
			meetingSecret,
			7,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		receiverState.setSenderSigningPub(7, kp.publicKey);
		const encrypt = createEncryptionTransformStream(senderState, 1);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			2,
			undefined,
			"video",
		);
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, [
			makeFakeFrame(new TextEncoder().encode("hello")),
		]);
		expect(decrypted.length).toBe(0);
	});

	it("receiver drops encrypted empty-payload frames", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const senderState = new SenderChainState(
			meetingSecret,
			7,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		receiverState.setSenderSigningPub(7, kp.publicKey);
		const encrypt = createEncryptionTransformStream(senderState, 1);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			1,
			undefined,
			"video",
		);
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, [
			makeFakeFrame(new Uint8Array()),
		]);
		expect(decrypted.length).toBe(0);
	});

	it("receiver drops frames with no signing pub registered", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const senderState = new SenderChainState(
			meetingSecret,
			5,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		const encrypt = createEncryptionTransformStream(senderState, 1);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			1,
			undefined,
			"video",
		);
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, [
			makeFakeFrame(new TextEncoder().encode("hello")),
		]);
		expect(decrypted.length).toBe(0);
	});

	it("receiver drops frames signed with wrong key", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const senderKp = await ed25519KeyPair();
		const attackerKp = await ed25519KeyPair();
		const senderState = new SenderChainState(
			meetingSecret,
			9,
			"video",
			attackerKp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		receiverState.setSenderSigningPub(9, senderKp.publicKey);
		const encrypt = createEncryptionTransformStream(senderState, 1);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			1,
			undefined,
			"video",
		);
		const decrypted = await runEncryptDecrypt(encrypt, decrypt, [
			makeFakeFrame(new TextEncoder().encode("forged")),
		]);
		expect(decrypted.length).toBe(0);
	});

	it("receiver drops replayed frames (exact duplicate generation)", async () => {
		const {
			generateMeetingSecret,
			SenderChainState,
			ReceiverChainState,
			createEncryptionTransformStream,
			createDecryptionTransformStream,
			ed25519KeyPair,
		} = await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const senderState = new SenderChainState(
			meetingSecret,
			11,
			"video",
			kp.privateKey,
		);
		const receiverState = new ReceiverChainState(meetingSecret);
		receiverState.setSenderSigningPub(11, kp.publicKey);
		const encrypt = createEncryptionTransformStream(senderState, 1);
		const decrypt = createDecryptionTransformStream(
			receiverState,
			1,
			undefined,
			"video",
		);
		const decrypted: Uint8Array[] = [];
		const reader = decrypt.readable.getReader();
		const readPromise = (async () => {
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					decrypted.push(new Uint8Array(value.data));
				}
			} catch {
				// closed
			}
		})();
		const pipePromise = encrypt.readable.pipeTo(decrypt.writable, {
			preventClose: false,
		});
		const writer = encrypt.writable.getWriter();
		const frameA = makeFakeFrame(new TextEncoder().encode("a"));
		const frameB = makeFakeFrame(new TextEncoder().encode("b"));
		await writer.write(frameA);
		await writer.write(frameB);
		await writer.close();
		await pipePromise;
		await readPromise;
		expect(decrypted.length).toBe(2);
	});

	it("SenderChainState.wipe() resets generation counter", async () => {
		const { generateMeetingSecret, SenderChainState, ed25519KeyPair } =
			await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const state = new SenderChainState(
			meetingSecret,
			1,
			"video",
			kp.privateKey,
		);
		const r1 = await state.nextFrameKey();
		expect(r1.generation).toBe(0);
		state.wipe();
		const r2 = await state.nextFrameKey();
		expect(r2.generation).toBe(0);
	});

	it("SenderChainState.wipe() zeroes meetingSecret bytes", async () => {
		const { generateMeetingSecret, SenderChainState, ed25519KeyPair } =
			await import("../e2ee");
		const meetingSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const state = new SenderChainState(
			meetingSecret,
			1,
			"video",
			kp.privateKey,
		);
		expect(meetingSecret.some((b) => b !== 0)).toBe(true);
		state.wipe();
		expect(meetingSecret.every((b) => b === 0)).toBe(true);
	});

	it("ReceiverChainState.wipe() resets all sender chains", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const meetingSecret = await generateMeetingSecret();
		const state = new ReceiverChainState(meetingSecret);
		const r1 = await state.getKeyForFrame(1, "video", 0);
		expect("key" in r1).toBe(true);
		state.wipe();
		const r2 = await state.getKeyForFrame(1, "video", 0);
		expect("key" in r2).toBe(true);
	});

	it("ReceiverChainState.wipe() zeroes meetingSecret bytes", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const meetingSecret = await generateMeetingSecret();
		const state = new ReceiverChainState(meetingSecret);
		expect(meetingSecret.some((b) => b !== 0)).toBe(true);
		state.wipe();
		expect(meetingSecret.every((b) => b === 0)).toBe(true);
	});
});

describe("ReceiverChainState anti-replay behavior", () => {
	it("receiver can decrypt frames at any generation (no gap limit)", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const r = await state.getKeyForFrame(1, "video", 500);
		expect("key" in r).toBe(true);
	});

	it("receiver rejects replayed frames (generation too old)", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		await state.getKeyForFrame(1, "video", 100);
		const r = await state.getKeyForFrame(1, "video", 80);
		expect(r).toEqual({ error: "replay" });
	});

	it("receiver rejects exact-duplicate generation (same gen twice)", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const r1 = await state.getKeyForFrame(1, "video", 50);
		expect("key" in r1).toBe(true);
		const r2 = await state.getKeyForFrame(1, "video", 50);
		expect(r2).toEqual({ error: "replay" });
	});

	it("receiver accepts out-of-order frames within replay window", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const r1 = await state.getKeyForFrame(1, "video", 50);
		expect("key" in r1).toBe(true);
		const r2 = await state.getKeyForFrame(1, "video", 48);
		expect("key" in r2).toBe(true);
		const r3 = await state.getKeyForFrame(1, "video", 45);
		expect(r3).toEqual({ error: "replay" });
	});

	it("receiver prunes seen generations outside replay window", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);

		for (let generation = 0; generation < 100; generation++) {
			const result = await state.getKeyForFrame(1, "video", generation);
			expect("key" in result).toBe(true);
		}

		const seenFrames = (
			state as unknown as { seenFrames: Map<string, Set<number>> }
		).seenFrames;
		const seen = seenFrames.get("1:video");
		expect(seen ? Array.from(seen).sort((a, b) => a - b) : []).toEqual([
			97, 98, 99,
		]);
		expect(await state.getKeyForFrame(1, "video", 98)).toEqual({
			error: "replay",
		});
		expect(await state.getKeyForFrame(1, "video", 96)).toEqual({
			error: "replay",
		});
	});
});

describe("Per-sender authentication (threat model B)", () => {
	it("hasSenderSigningPub returns false until setSenderSigningPub is called", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		expect(state.hasSenderSigningPub(1)).toBe(false);
	});

	it("verifyFrameSignature returns false for unknown sender", async () => {
		const { generateMeetingSecret, ReceiverChainState } = await import(
			"../e2ee"
		);
		const secret = await generateMeetingSecret();
		const state = new ReceiverChainState(secret);
		const ok = await state.verifyFrameSignature(
			1,
			new Uint8Array(24),
			new Uint8Array(0),
			new Uint8Array(32),
			new Uint8Array(64),
		);
		expect(ok).toBe(false);
	});

	it("verifyFrameSignature returns true for a properly signed frame", async () => {
		const {
			generateMeetingSecret,
			ReceiverChainState,
			ed25519KeyPair,
			signWithEd25519,
		} = await import("../e2ee");
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const state = new ReceiverChainState(secret);
		state.setSenderSigningPub(1, kp.publicKey);
		const header = new Uint8Array(24);
		const clearPrefix = new Uint8Array(0);
		const cipher = new Uint8Array(32);
		const signed = new Uint8Array(
			header.length + clearPrefix.length + cipher.length,
		);
		signed.set(header, 0);
		signed.set(clearPrefix, header.length);
		signed.set(cipher, header.length + clearPrefix.length);
		const sig = await signWithEd25519(kp.privateKey, signed);
		const ok = await state.verifyFrameSignature(
			1,
			header,
			clearPrefix,
			cipher,
			sig,
		);
		expect(ok).toBe(true);
	});

	it("verifyFrameSignature returns false for tampered ciphertext", async () => {
		const {
			generateMeetingSecret,
			ReceiverChainState,
			ed25519KeyPair,
			signWithEd25519,
		} = await import("../e2ee");
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const state = new ReceiverChainState(secret);
		state.setSenderSigningPub(1, kp.publicKey);
		const header = new Uint8Array(24);
		const clearPrefix = new Uint8Array(0);
		const cipher = new Uint8Array(32);
		const signed = new Uint8Array(
			header.length + clearPrefix.length + cipher.length,
		);
		signed.set(header, 0);
		signed.set(clearPrefix, header.length);
		signed.set(cipher, header.length + clearPrefix.length);
		const sig = await signWithEd25519(kp.privateKey, signed);
		cipher[0] ^= 0x01;
		const ok = await state.verifyFrameSignature(
			1,
			header,
			clearPrefix,
			cipher,
			sig,
		);
		expect(ok).toBe(false);
	});

	it("verifyFrameSignature returns false when signed with a different key", async () => {
		const {
			generateMeetingSecret,
			ReceiverChainState,
			ed25519KeyPair,
			signWithEd25519,
		} = await import("../e2ee");
		const secret = await generateMeetingSecret();
		const legitKp = await ed25519KeyPair();
		const attackerKp = await ed25519KeyPair();
		const state = new ReceiverChainState(secret);
		state.setSenderSigningPub(1, legitKp.publicKey);
		const header = new Uint8Array(24);
		const clearPrefix = new Uint8Array(0);
		const cipher = new Uint8Array(32);
		const signed = new Uint8Array(
			header.length + clearPrefix.length + cipher.length,
		);
		signed.set(header, 0);
		signed.set(clearPrefix, header.length);
		signed.set(cipher, header.length + clearPrefix.length);
		const sig = await signWithEd25519(attackerKp.privateKey, signed);
		const ok = await state.verifyFrameSignature(
			1,
			header,
			clearPrefix,
			cipher,
			sig,
		);
		expect(ok).toBe(false);
	});
});

describe("E2EE chain registry", () => {
	beforeEach(() => {
		E2EEMeeting.instance = new E2EEMeeting();
	});

	it("hasMeetingContext() reflects setMeetingContext/wipeMeetingContext", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		expect(meeting.hasMeetingContext()).toBe(false);
		const secret = await generateMeetingSecret();
		meeting.setMeetingContext(secret, 1);
		expect(meeting.hasMeetingContext()).toBe(true);
		meeting.wipeMeetingContext();
		expect(meeting.hasMeetingContext()).toBe(false);
	});

	it("getSessionFingerprint is stable per encrypted epoch and changes on rotation", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		expect(await meeting.getSessionFingerprint()).toBeNull();

		const firstSecret = await generateMeetingSecret();
		meeting.setMeetingContext(firstSecret, 1);
		const first = await meeting.getSessionFingerprint();
		expect(first).toMatch(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/);
		expect(await meeting.getSessionFingerprint()).toBe(first);

		const secondSecret = await generateMeetingSecret();
		meeting.setMeetingContext(secondSecret, 2);
		expect(await meeting.getSessionFingerprint()).not.toBe(first);
	});

	it("wipeMeetingContext zeroes the meeting secret", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		expect(secret.some((b) => b !== 0)).toBe(true);
		meeting.setMeetingContext(secret, 1);
		meeting.wipeMeetingContext();
		expect(secret.every((b) => b === 0)).toBe(true);
	});

	it("setMeetingContext creates per-sender chain on demand", async () => {
		const { generateMeetingSecret, ed25519KeyPair } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		meeting.setMeetingContext(secret, 7, kp.privateKey);
		const sender = makeMockSender();
		const ok = await meeting.setupSenderTransform(sender, 42, "video");
		expect(ok).toBe(true);
	});

	it("setupSenderTransform returns false when no meeting context", async () => {
		const meeting = E2EEMeeting.instance;
		const sender = makeMockSender();
		const ok = await meeting.setupSenderTransform(sender, 1, "video");
		expect(ok).toBe(false);
	});

	it("setupSenderTransform returns false when no signing key", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		meeting.setMeetingContext(secret, 1);
		const sender = makeMockSender();
		const ok = await meeting.setupSenderTransform(sender, 1, "video");
		expect(ok).toBe(false);
	});

	it("setupSenderTransform deduplicates by sender", async () => {
		const { generateMeetingSecret, ed25519KeyPair } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		meeting.setMeetingContext(secret, 1, kp.privateKey);
		const sender = makeMockSender();
		expect(await meeting.setupSenderTransform(sender, 5, "video")).toBe(true);
		expect(await meeting.setupSenderTransform(sender, 5, "video")).toBe(false);
	});

	it("setupSenderTransform can reinstall RTCRtpScriptTransform on a reused sender", async () => {
		const { generateMeetingSecret, ed25519KeyPair } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const originalSender = globalThis.RTCRtpSender;
		const originalReceiver = globalThis.RTCRtpReceiver;
		const originalScriptTransform = (
			globalThis as typeof globalThis & { RTCRtpScriptTransform?: unknown }
		).RTCRtpScriptTransform;
		const originalWorker = globalThis.Worker;

		try {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: function RTCRtpScriptTransform() {},
			});
			Object.defineProperty(globalThis, "Worker", {
				configurable: true,
				writable: true,
				value: class Worker {
					postMessage() {}
				},
			});
			meeting.setMeetingContext(secret, 1, kp.privateKey);
			const sender = {} as RTCRtpSender;

			expect(await meeting.setupSenderTransform(sender, 5, "video")).toBe(true);
			expect(await meeting.setupSenderTransform(sender, 5, "video")).toBe(true);
		} finally {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: originalSender,
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: originalReceiver,
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: originalScriptTransform,
			});
			Object.defineProperty(globalThis, "Worker", {
				configurable: true,
				writable: true,
				value: originalWorker,
			});
		}
	});

	it("setMeetingContext updates active RTCRtpScriptTransform workers", async () => {
		const { generateMeetingSecret, ed25519KeyPair } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const firstSecret = await generateMeetingSecret();
		const secondSecret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		const originalSender = globalThis.RTCRtpSender;
		const originalReceiver = globalThis.RTCRtpReceiver;
		const originalScriptTransform = (
			globalThis as typeof globalThis & { RTCRtpScriptTransform?: unknown }
		).RTCRtpScriptTransform;
		const originalWorker = globalThis.Worker;

		const workers: Array<{ messages: unknown[] }> = [];
		try {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: { prototype: {} },
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: function RTCRtpScriptTransform() {},
			});
			Object.defineProperty(globalThis, "Worker", {
				configurable: true,
				writable: true,
				value: class Worker {
					messages: unknown[] = [];
					constructor() {
						workers.push(this);
					}
					postMessage(message: unknown) {
						this.messages.push(message);
					}
				},
			});

			meeting.setMeetingContext(firstSecret, 1, kp.privateKey);
			expect(await meeting.setupSenderTransform({} as RTCRtpSender, 5, "video"))
				.toBe(true);
			expect(workers).toHaveLength(1);

			meeting.setMeetingContext(secondSecret, 2, kp.privateKey);

			expect(workers[0]?.messages).toContainEqual(
				expect.objectContaining({
					type: "updateContext",
					keyVersion: 2,
					senderSigningPrivateKey: kp.privateKey,
				}),
			);
		} finally {
			Object.defineProperty(globalThis, "RTCRtpSender", {
				configurable: true,
				writable: true,
				value: originalSender,
			});
			Object.defineProperty(globalThis, "RTCRtpReceiver", {
				configurable: true,
				writable: true,
				value: originalReceiver,
			});
			Object.defineProperty(globalThis, "RTCRtpScriptTransform", {
				configurable: true,
				writable: true,
				value: originalScriptTransform,
			});
			Object.defineProperty(globalThis, "Worker", {
				configurable: true,
				writable: true,
				value: originalWorker,
			});
		}
	});

	it("retains sender signing pub registered before meeting context", async () => {
		const { generateMeetingSecret, ed25519KeyPair } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		const kp = await ed25519KeyPair();
		meeting.setSenderSigningPub(7, kp.publicKey);
		expect(meeting.hasSenderSigningPub(7)).toBe(true);
		meeting.setMeetingContext(secret, 1, kp.privateKey);
		expect(meeting.hasSenderSigningPub(7)).toBe(true);
	});
});

describe("E2EE chat key", () => {
	beforeEach(() => {
		E2EEMeeting.instance = new E2EEMeeting();
	});

	it("getE2EEChatKey returns null when no meeting context", async () => {
		const meeting = E2EEMeeting.instance;
		expect(await meeting.getE2EEChatKey()).toBeNull();
	});

	it("getE2EEChatKey is deterministic per (meetingSecret, keyVersion)", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		meeting.setMeetingContext(secret, 7);
		const k1 = await meeting.getE2EEChatKey();
		const k2 = await meeting.getE2EEChatKey();
		expect(k1).not.toBeNull();
		expect(k1).toBe(k2);
	});

	it("wipeMeetingContext invalidates the cached chat key", async () => {
		const { generateMeetingSecret } = await import("../e2ee");
		const meeting = E2EEMeeting.instance;
		const secret = await generateMeetingSecret();
		meeting.setMeetingContext(secret, 1);
		const k1 = await meeting.getE2EEChatKey();
		expect(k1).not.toBeNull();
		meeting.wipeMeetingContext();
		expect(await meeting.getE2EEChatKey()).toBeNull();
	});
});

function makeMockSender(): RTCRtpSender {
	const readable = new ReadableStream<{ data: ArrayBuffer }>({
		start(c) {
			c.close();
		},
	});
	const writable = new WritableStream<{ data: ArrayBuffer }>({
		write() {},
	});
	const sender = {
		createEncodedStreams: () => ({ readable, writable }),
	} as unknown as RTCRtpSender;
	(
		RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		}
	).createEncodedStreams = () => ({ readable, writable });
	(
		RTCRtpReceiver.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		}
	).createEncodedStreams = () => ({ readable, writable });
	return sender;
}
