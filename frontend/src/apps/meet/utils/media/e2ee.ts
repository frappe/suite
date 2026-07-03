import { bufferToBase64, bytesFromBase64 } from "./e2eePrimitives";
import {
	buildSignedFramePayload,
	decodeFrameHeader,
	deriveFrameKey,
	EMPTY_FRAME_MAGIC,
	encodeFrameHeader,
	FRAME_HEADER_FIXED_SIZE,
	FRAME_HEADER_TOTAL,
	FRAME_MAGIC,
	getClearPrefix,
	getClearPrefixSize,
	hasFrameMagic,
	MIN_SIGNED_ENCRYPTED_FRAME_SIZE,
	REPLAY_WINDOW,
} from "./frameCodec";

function zeroUint8Array(arr: Uint8Array): void {
	arr.fill(0);
}

type EncodedStreams = {
	readable?: ReadableStream;
	readableStream?: ReadableStream;
	writable?: WritableStream;
	writableStream?: WritableStream;
};

type EncodedFrameLike = {
	data: ArrayBuffer;
	type?: string;
};

export type SenderWithInsertableStreams = RTCRtpSender & {
	createEncodedStreams?: () => EncodedStreams;
};

export type ReceiverWithInsertableStreams = RTCRtpReceiver & {
	createEncodedStreams?: () => EncodedStreams;
};

export type TransformableSender = RTCRtpSender & {
	transform?: unknown;
};

export type TransformableReceiver = RTCRtpReceiver & {
	transform?: unknown;
};

type RTCRtpScriptTransformConstructor = new (
	worker: Worker,
	options: Record<string, unknown>,
) => unknown;

type E2EETransformCapability =
	| "legacy-insertable-streams"
	| "rtp-script-transform"
	| "none";

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error("SubtleCrypto not available");
	}
	return subtle;
}

export async function x25519KeyPair(): Promise<CryptoKeyPair> {
	return getSubtle().generateKey("X25519", true, ["deriveBits"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
	const raw = await getSubtle().exportKey("raw", key);
	return bufferToBase64(raw);
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
	return getSubtle().importKey("raw", bytesFromBase64(b64), "X25519", true, []);
}

export async function exportEd25519PublicKey(key: CryptoKey): Promise<string> {
	const raw = await getSubtle().exportKey("raw", key);
	return bufferToBase64(raw);
}

export async function importEd25519PublicKey(b64: string): Promise<CryptoKey> {
	return getSubtle().importKey(
		"raw",
		bytesFromBase64(b64),
		{ name: "Ed25519" },
		true,
		["verify"],
	);
}

export async function ed25519KeyPair(): Promise<CryptoKeyPair> {
	return getSubtle().generateKey("Ed25519", true, ["sign", "verify"]);
}

export async function signProof(
	privateKey: CryptoKey,
	payload: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const sig = await getSubtle().sign({ name: "Ed25519" }, privateKey, payload);
	return bufferToBase64(sig);
}

export async function verifyProof(
	publicKey: CryptoKey,
	payload: Uint8Array<ArrayBuffer>,
	signatureB64: string,
): Promise<boolean> {
	return getSubtle().verify(
		{ name: "Ed25519" },
		publicKey,
		bytesFromBase64(signatureB64),
		payload,
	);
}

export async function ecdhKeyAgreement(
	localPrivate: CryptoKey,
	remotePublic: CryptoKey,
): Promise<Uint8Array<ArrayBuffer>> {
	const bits = await getSubtle().deriveBits(
		{ name: "X25519", public: remotePublic },
		localPrivate,
		256,
	);
	const out = new Uint8Array(32);
	out.set(new Uint8Array(bits));
	return out;
}

export async function signWithEd25519(
	privateKey: CryptoKey,
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	const sig = await getSubtle().sign({ name: "Ed25519" }, privateKey, data);
	const out = new Uint8Array(sig.byteLength);
	out.set(new Uint8Array(sig));
	return out;
}

async function verifyWithEd25519(
	publicKey: CryptoKey,
	signature: Uint8Array<ArrayBuffer>,
	data: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
	return getSubtle().verify({ name: "Ed25519" }, publicKey, signature, data);
}

async function _hkdfBits(
	ikm: Uint8Array<ArrayBuffer>,
	info: Uint8Array<ArrayBuffer>,
	length = 32,
): Promise<Uint8Array<ArrayBuffer>> {
	const subtle = getSubtle();
	const baseKey = await subtle.importKey("raw", ikm, "HKDF", false, [
		"deriveBits",
	]);
	const bits = await subtle.deriveBits(
		{ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info },
		baseKey,
		length * 8,
	);
	const out = new Uint8Array(length);
	out.set(new Uint8Array(bits));
	return out;
}

export async function generateMeetingSecret(): Promise<
	Uint8Array<ArrayBuffer>
> {
	return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export {
	advanceChain,
	chainTipToAESKey,
	initSenderChain,
} from "./frameCodec";

export class SenderChainState {
	readonly senderId: number;
	readonly mediaType: string;
	private meetingSecret: Uint8Array<ArrayBuffer>;
	private signingPrivateKey: CryptoKey;
	private nextGeneration = 0;

	constructor(
		meetingSecret: Uint8Array<ArrayBuffer>,
		senderId: number,
		mediaType: string,
		signingPrivateKey: CryptoKey,
	) {
		this.meetingSecret = meetingSecret;
		this.senderId = senderId;
		this.mediaType = mediaType;
		this.signingPrivateKey = signingPrivateKey;
	}

	async nextFrameKey(): Promise<{ key: CryptoKey; generation: number }> {
		const generation = this.nextGeneration++;
		const key = await deriveFrameKey(
			this.meetingSecret,
			this.senderId,
			this.mediaType,
			generation,
		);
		return { key, generation };
	}

	async signFramePayload(
		headerFixed: Uint8Array<ArrayBuffer>,
		clearPrefix: Uint8Array<ArrayBuffer>,
		frameMagicOrCiphertext: Uint8Array<ArrayBuffer>,
		maybeCiphertext?: Uint8Array<ArrayBuffer>,
	): Promise<Uint8Array<ArrayBuffer>> {
		const frameMagic = maybeCiphertext
			? frameMagicOrCiphertext
			: EMPTY_FRAME_MAGIC;
		const ciphertext = maybeCiphertext ?? frameMagicOrCiphertext;
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		return signWithEd25519(this.signingPrivateKey, signed);
	}

	updateContext(
		meetingSecret: Uint8Array<ArrayBuffer>,
		signingPrivateKey: CryptoKey,
	): void {
		zeroUint8Array(this.meetingSecret);
		this.meetingSecret = meetingSecret;
		this.signingPrivateKey = signingPrivateKey;
		this.nextGeneration = 0;
	}

	wipe(): void {
		zeroUint8Array(this.meetingSecret);
		this.nextGeneration = 0;
	}
}

export class ReceiverChainState {
	private meetingSecret: Uint8Array<ArrayBuffer>;
	private readonly highWaterMark = new Map<string, number>();
	private readonly signingPubs = new Map<number, CryptoKey>();
	private readonly seenFrames = new Map<string, Set<number>>();
	private readonly frameKeyCache = new Map<
		string,
		{ generation: number; key: CryptoKey }
	>();

	constructor(meetingSecret: Uint8Array<ArrayBuffer>) {
		this.meetingSecret = meetingSecret;
	}

	setSenderSigningPub(senderId: number, pub: CryptoKey): void {
		this.signingPubs.set(senderId, pub);
	}

	hasSenderSigningPub(senderId: number): boolean {
		return this.signingPubs.has(senderId);
	}

	updateContext(meetingSecret: Uint8Array<ArrayBuffer>): void {
		zeroUint8Array(this.meetingSecret);
		this.meetingSecret = meetingSecret;
		this.highWaterMark.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}

	async getKeyForFrame(
		senderId: number,
		mediaType: string,
		generation: number,
	): Promise<{ key: CryptoKey } | { error: "replay" }> {
		const key = `${senderId}:${mediaType}`;
		const hwm = this.highWaterMark.get(key) ?? -1;
		if (generation <= hwm - REPLAY_WINDOW) {
			return { error: "replay" };
		}
		const seen = this.seenFrames.get(key) ?? new Set<number>();
		if (seen.has(generation)) {
			return { error: "replay" };
		}
		if (generation > hwm) {
			this.highWaterMark.set(key, generation);
			const pruneAtOrBefore = generation - REPLAY_WINDOW;
			for (const seenGeneration of seen) {
				if (seenGeneration <= pruneAtOrBefore) {
					seen.delete(seenGeneration);
				}
			}
		}
		seen.add(generation);
		this.seenFrames.set(key, seen);
		const cached = this.frameKeyCache.get(key);
		let aesKey: CryptoKey;
		if (cached && cached.generation === generation) {
			aesKey = cached.key;
		} else {
			aesKey = await deriveFrameKey(
				this.meetingSecret,
				senderId,
				mediaType,
				generation,
			);
			this.frameKeyCache.set(key, { generation, key: aesKey });
		}
		return { key: aesKey };
	}

	async verifyFrameSignature(
		senderId: number,
		headerFixed: Uint8Array<ArrayBuffer>,
		clearPrefix: Uint8Array<ArrayBuffer>,
		frameMagicOrCiphertext: Uint8Array<ArrayBuffer>,
		ciphertextOrSignature: Uint8Array<ArrayBuffer>,
		maybeSignature?: Uint8Array<ArrayBuffer>,
	): Promise<boolean> {
		const pub = this.signingPubs.get(senderId);
		if (!pub) return false;
		const frameMagic = maybeSignature
			? frameMagicOrCiphertext
			: EMPTY_FRAME_MAGIC;
		const ciphertext = maybeSignature
			? ciphertextOrSignature
			: frameMagicOrCiphertext;
		const signature = maybeSignature ?? ciphertextOrSignature;
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		return verifyWithEd25519(pub, signature, signed);
	}

	wipe(): void {
		zeroUint8Array(this.meetingSecret);
		this.highWaterMark.clear();
		this.signingPubs.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}
}

export function createEncryptionTransformStream(
	chainState: SenderChainState,
	keyVersion: number | (() => number),
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const currentKeyVersion =
				typeof keyVersion === "function" ? keyVersion() : keyVersion;
			const subtle = getSubtle();
			const typedFrame = encodedFrame as EncodedFrameLike;
			const clearPrefix = getClearPrefix(
				typedFrame.data,
				getClearPrefixSize(chainState.mediaType),
			);
			try {
				const { key, generation } = await chainState.nextFrameKey();
				const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
				const header = encodeFrameHeader({
					senderId: chainState.senderId,
					generation,
					frameType: typedFrame.type,
					keyVersion: currentKeyVersion,
					epochNumber: currentKeyVersion,
					iv,
				});
				const headerBuf = new Uint8Array(header.length);
				headerBuf.set(header);
				const encrypted = await subtle.encrypt(
					{ name: "AES-GCM", iv, additionalData: headerBuf },
					key,
					encodedFrame.data,
				);
				const cipherBytes = new Uint8Array(encrypted.byteLength);
				cipherBytes.set(new Uint8Array(encrypted));
				const signature = await chainState.signFramePayload(
					headerBuf,
					clearPrefix,
					FRAME_MAGIC,
					cipherBytes,
				);
				const totalSize =
					clearPrefix.byteLength +
					FRAME_MAGIC.byteLength +
					headerBuf.length +
					signature.byteLength +
					cipherBytes.byteLength;
				const newData = new Uint8Array(totalSize);
				newData.set(clearPrefix, 0);
				newData.set(FRAME_MAGIC, clearPrefix.byteLength);
				newData.set(headerBuf, clearPrefix.byteLength + FRAME_MAGIC.byteLength);
				newData.set(
					signature,
					clearPrefix.byteLength + FRAME_MAGIC.byteLength + headerBuf.length,
				);
				newData.set(
					cipherBytes,
					clearPrefix.byteLength +
						FRAME_MAGIC.byteLength +
						headerBuf.length +
						signature.byteLength,
				);
				encodedFrame.data = newData.buffer;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE: encryption failed, dropping frame:", error);
			}
		},
	});
}

export function createDecryptionTransformStream(
	chainState: ReceiverChainState,
	expectedKeyVersion: number | (() => number),
	_receiver: RTCRtpReceiver | undefined,
	mediaType: string,
): TransformStream {
	return new TransformStream({
		async transform(encodedFrame, controller) {
			const currentExpectedKeyVersion =
				typeof expectedKeyVersion === "function"
					? expectedKeyVersion()
					: expectedKeyVersion;
			const subtle = getSubtle();
			const data = new Uint8Array(encodedFrame.data);
			const clearPrefixSize = getClearPrefixSize(mediaType);
			if (data.length < clearPrefixSize + MIN_SIGNED_ENCRYPTED_FRAME_SIZE) {
				return;
			}
			const clearPrefix = data.slice(0, clearPrefixSize);
			const magicOffset = clearPrefixSize;
			if (!hasFrameMagic(data, magicOffset)) {
				return;
			}
			const frameMagic = data.slice(
				magicOffset,
				magicOffset + FRAME_MAGIC.byteLength,
			);
			const headerOffset = magicOffset + FRAME_MAGIC.byteLength;
			const headerEnd = headerOffset + FRAME_HEADER_FIXED_SIZE;
			const signatureEnd = headerOffset + FRAME_HEADER_TOTAL;
			const header = decodeFrameHeader(data.subarray(headerOffset, headerEnd));
			if (!header) {
				return;
			}
			if (header.keyVersion !== currentExpectedKeyVersion) {
				console.warn("[E2EE] decrypt: key version mismatch", {
					header: header.keyVersion,
					expected: currentExpectedKeyVersion,
					senderId: header.senderId,
					mediaType,
				});
				return;
			}
			if (header.epochNumber !== currentExpectedKeyVersion) {
				console.warn("[E2EE] decrypt: epoch mismatch", {
					header: header.epochNumber,
					expected: currentExpectedKeyVersion,
					senderId: header.senderId,
					mediaType,
				});
				return;
			}
			const headerFixed = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
			headerFixed.set(data.subarray(headerOffset, headerEnd));
			const signature = data.slice(headerEnd, signatureEnd);
			const ciphertext = data.slice(signatureEnd);
			const sigOk = await chainState.verifyFrameSignature(
				header.senderId,
				headerFixed,
				clearPrefix,
				frameMagic,
				ciphertext,
				signature,
			);
			if (!sigOk) {
				console.warn("[E2EE] decrypt: signature verification failed", {
					senderId: header.senderId,
					mediaType,
				});
				return;
			}
			const result = await chainState.getKeyForFrame(
				header.senderId,
				mediaType,
				header.generation,
			);
			if ("error" in result) {
				return;
			}
			try {
				const decrypted = await subtle.decrypt(
					{ name: "AES-GCM", iv: header.iv, additionalData: headerFixed },
					result.key,
					ciphertext,
				);
				encodedFrame.data = decrypted;
				controller.enqueue(encodedFrame);
			} catch (error) {
				console.warn("E2EE: decrypt failed, dropping frame:", error);
			}
		},
	});
}

function hasLegacyInsertableStreamSupport(): boolean {
	if (typeof globalThis.RTCRtpSender === "undefined") return false;
	if (typeof globalThis.RTCRtpReceiver === "undefined") return false;
	try {
		const senderProto = globalThis.RTCRtpSender.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		};
		const receiverProto = globalThis.RTCRtpReceiver.prototype as unknown as {
			createEncodedStreams?: () => unknown;
		};
		return (
			Object.hasOwn(senderProto, "createEncodedStreams") &&
			Object.hasOwn(receiverProto, "createEncodedStreams") &&
			typeof senderProto.createEncodedStreams === "function" &&
			typeof receiverProto.createEncodedStreams === "function"
		);
	} catch {
		return false;
	}
}

function getRTCRtpScriptTransform(): RTCRtpScriptTransformConstructor | null {
	return (
		(
			globalThis as typeof globalThis & {
				RTCRtpScriptTransform?: RTCRtpScriptTransformConstructor;
			}
		).RTCRtpScriptTransform ?? null
	);
}

export function getE2EETransformCapability(): E2EETransformCapability {
	if (hasLegacyInsertableStreamSupport()) return "legacy-insertable-streams";
	if (getRTCRtpScriptTransform()) return "rtp-script-transform";
	return "none";
}
