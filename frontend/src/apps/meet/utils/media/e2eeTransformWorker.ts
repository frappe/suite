import {
	buildSignedFramePayload,
	decodeFrameHeader,
	deriveFrameKey,
	encodeFrameHeader,
	FRAME_HEADER_FIXED_SIZE,
	FRAME_HEADER_TOTAL,
	FRAME_MAGIC,
	getClearPrefix,
	getClearPrefixSize,
	hasFrameMagic,
	MIN_SIGNED_ENCRYPTED_FRAME_SIZE,
} from "./frameCodec";

// Worker uses a longer replay window than the main thread (3). The
// main thread is on the realtime path; the worker is on a separate
// thread with more headroom. See frameCodec.ts for the rationale.
const REPLAY_WINDOW = 100;

const SENDER_KEY_CACHE_MAX = 64;
const DUMMY_VERIFY_MSG = new Uint8Array(0);
const DUMMY_VERIFY_SIG = new Uint8Array(64);

type EncodedFrame = {
	data: ArrayBuffer;
	type?: string;
};

type WorkerOptions = {
	direction: "send" | "recv";
	meetingSecret: Uint8Array<ArrayBuffer>;
	keyVersion: number;
	senderId: number;
	mediaType: string;
	senderSigningPrivateKey?: CryptoKey;
	senderSigningPubs?: Array<[number, CryptoKey]>;
};

type WorkerMessage =
	| { type: "addSenderSigningPub"; senderId: number; signingPub: CryptoKey }
	| {
			type: "updateContext";
			meetingSecret: Uint8Array<ArrayBuffer>;
			keyVersion: number;
			senderSigningPrivateKey?: CryptoKey;
			senderSigningPubs: Array<[number, CryptoKey]>;
	  }
	| {
			type: "prewarm";
			mediaType: string;
			senderSigningPubs: Array<[number, CryptoKey]>;
	  }
	| { type: "wipe" };

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("SubtleCrypto not available");
	return subtle;
}

async function warmSubtleCrypto(): Promise<void> {
	try {
		await getSubtle().digest("SHA-256", new Uint8Array(0));
	} catch {
		// best-effort: ignore warm-up errors
	}
}

void warmSubtleCrypto();

class SendState {
	private nextGeneration = 0;

	constructor(
		private meetingSecret: Uint8Array<ArrayBuffer>,
		private senderId: number,
		private mediaType: string,
		private signingPrivateKey: CryptoKey,
	) {}

	updateContext(
		meetingSecret: Uint8Array<ArrayBuffer>,
		signingPrivateKey: CryptoKey,
	): void {
		this.meetingSecret.fill(0);
		this.meetingSecret = meetingSecret;
		this.signingPrivateKey = signingPrivateKey;
		this.nextGeneration = 0;
	}

	async encrypt(
		frame: EncodedFrame,
		keyVersion: number,
	): Promise<EncodedFrame | null> {
		const subtle = getSubtle();
		const generation = this.nextGeneration++;
		const clearPrefix = getClearPrefix(
			frame.data,
			getClearPrefixSize(this.mediaType),
		);
		const key = await deriveFrameKey(
			this.meetingSecret,
			this.senderId,
			this.mediaType,
			generation,
		);
		const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
		const header = encodeFrameHeader({
			senderId: this.senderId,
			generation,
			frameType: frame.type,
			keyVersion,
			epochNumber: keyVersion,
			iv,
		});
		const encrypted = await subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: header },
			key,
			frame.data,
		);
		const ciphertext = new Uint8Array(encrypted.byteLength);
		ciphertext.set(new Uint8Array(encrypted));
		const signed = buildSignedFramePayload(
			header,
			clearPrefix,
			FRAME_MAGIC,
			ciphertext,
		);
		const signature = new Uint8Array(
			await subtle.sign({ name: "Ed25519" }, this.signingPrivateKey, signed),
		);
		const out = new Uint8Array(
			clearPrefix.byteLength +
				FRAME_MAGIC.byteLength +
				header.byteLength +
				signature.byteLength +
				ciphertext.byteLength,
		);
		out.set(clearPrefix, 0);
		out.set(FRAME_MAGIC, clearPrefix.byteLength);
		out.set(header, clearPrefix.byteLength + FRAME_MAGIC.byteLength);
		out.set(
			signature,
			clearPrefix.byteLength + FRAME_MAGIC.byteLength + header.byteLength,
		);
		out.set(
			ciphertext,
			clearPrefix.byteLength +
				FRAME_MAGIC.byteLength +
				header.byteLength +
				signature.byteLength,
		);
		frame.data = out.buffer;
		return frame;
	}

	wipe(): void {
		this.meetingSecret.fill(0);
	}
}

class RecvState {
	private signingPubs = new Map<number, CryptoKey>();
	private highWaterMark = new Map<string, number>();
	private seenFrames = new Map<string, Set<number>>();
	private frameKeyCache = new Map<
		string,
		{ generation: number; key: CryptoKey }
	>();

	constructor(
		private meetingSecret: Uint8Array<ArrayBuffer>,
		initialSigningPubs: Array<[number, CryptoKey]>,
	) {
		for (const [senderId, pub] of initialSigningPubs) {
			this.signingPubs.set(senderId, pub);
		}
	}

	setSenderSigningPub(senderId: number, signingPub: CryptoKey): void {
		this.signingPubs.set(senderId, signingPub);
	}

	updateContext(
		meetingSecret: Uint8Array<ArrayBuffer>,
		senderSigningPubs: Array<[number, CryptoKey]>,
	): void {
		this.meetingSecret.fill(0);
		this.meetingSecret = meetingSecret;
		for (const [senderId, pub] of senderSigningPubs) {
			this.signingPubs.set(senderId, pub);
		}
		this.highWaterMark.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}

	async warmSigningPub(pub: CryptoKey): Promise<void> {
		try {
			await getSubtle().verify(
				{ name: "Ed25519" },
				pub,
				DUMMY_VERIFY_SIG,
				DUMMY_VERIFY_MSG,
			);
		} catch {
			// best-effort: a verify against an obviously-bad signature must fail;
			// the goal is to warm the Ed25519 code path, not to authenticate.
		}
	}

	async prewarmFrameKeys(mediaType: string): Promise<void> {
		const senderIds = Array.from(this.signingPubs.keys());
		await Promise.all(
			senderIds.map(async (senderId) => {
				const key = await deriveFrameKey(
					this.meetingSecret,
					senderId,
					mediaType,
					0,
				);
				this.cacheFrameKey(senderId, mediaType, 0, key);
			}),
		);
	}

	private cacheFrameKey(
		senderId: number,
		mediaType: string,
		generation: number,
		key: CryptoKey,
	): void {
		const cacheKey = `${senderId}:${mediaType}`;
		const existing = this.frameKeyCache.get(cacheKey);
		if (existing && existing.generation === generation) return;
		this.frameKeyCache.set(cacheKey, { generation, key });
		while (this.frameKeyCache.size > SENDER_KEY_CACHE_MAX) {
			const oldestKey = this.frameKeyCache.keys().next().value;
			if (oldestKey === undefined) break;
			this.frameKeyCache.delete(oldestKey);
		}
	}

	private getCachedFrameKey(
		senderId: number,
		mediaType: string,
		generation: number,
	): CryptoKey | null {
		const cacheKey = `${senderId}:${mediaType}`;
		const entry = this.frameKeyCache.get(cacheKey);
		if (!entry || entry.generation !== generation) return null;
		return entry.key;
	}

	async decrypt(
		frame: EncodedFrame,
		expectedKeyVersion: number,
		mediaType: string,
	): Promise<EncodedFrame | null> {
		const subtle = getSubtle();
		const data = new Uint8Array(frame.data);
		const clearPrefixSize = getClearPrefixSize(mediaType);
		if (data.length < clearPrefixSize + MIN_SIGNED_ENCRYPTED_FRAME_SIZE) {
			return null;
		}
		const clearPrefix = data.slice(0, clearPrefixSize);
		const magicOffset = clearPrefixSize;
		if (!hasFrameMagic(data, magicOffset)) {
			return null;
		}
		const frameMagic = data.slice(
			magicOffset,
			magicOffset + FRAME_MAGIC.byteLength,
		);
		const headerOffset = magicOffset + FRAME_MAGIC.byteLength;
		const headerEnd = headerOffset + FRAME_HEADER_FIXED_SIZE;
		const signatureEnd = headerOffset + FRAME_HEADER_TOTAL;
		const header = decodeFrameHeader(data.subarray(headerOffset, headerEnd));
		if (
			!header ||
			header.keyVersion !== expectedKeyVersion ||
			header.epochNumber !== expectedKeyVersion
		) {
			return null;
		}
		const signingPub = this.signingPubs.get(header.senderId);
		if (!signingPub) {
			return null;
		}
		const headerFixed = new Uint8Array(FRAME_HEADER_FIXED_SIZE);
		headerFixed.set(data.subarray(headerOffset, headerEnd));
		const signature = data.slice(headerEnd, signatureEnd);
		const ciphertext = data.slice(signatureEnd);
		const signed = buildSignedFramePayload(
			headerFixed,
			clearPrefix,
			frameMagic,
			ciphertext,
		);
		const sigOk = await subtle.verify(
			{ name: "Ed25519" },
			signingPub,
			signature,
			signed,
		);
		if (
			!sigOk ||
			!this.markSeen(header.senderId, mediaType, header.generation)
		) {
			return null;
		}
		const cached = this.getCachedFrameKey(
			header.senderId,
			mediaType,
			header.generation,
		);
		const key =
			cached ??
			(await deriveFrameKey(
				this.meetingSecret,
				header.senderId,
				mediaType,
				header.generation,
			));
		if (!cached) {
			this.cacheFrameKey(header.senderId, mediaType, header.generation, key);
		}
		try {
			const decrypted = await subtle.decrypt(
				{ name: "AES-GCM", iv: header.iv, additionalData: headerFixed },
				key,
				ciphertext,
			);
			frame.data = decrypted;
		} catch {
			return null;
		}
		void this.deriveNextFrameKey(header.senderId, mediaType, header.generation);
		return frame;
	}

	private async deriveNextFrameKey(
		senderId: number,
		mediaType: string,
		currentGeneration: number,
	): Promise<void> {
		try {
			const nextGeneration = currentGeneration + 1;
			const nextKey = await deriveFrameKey(
				this.meetingSecret,
				senderId,
				mediaType,
				nextGeneration,
			);
			this.cacheFrameKey(senderId, mediaType, nextGeneration, nextKey);
		} catch {
			// best-effort: a background pre-derive failure is not fatal
		}
	}

	private markSeen(
		senderId: number,
		mediaType: string,
		generation: number,
	): boolean {
		const key = `${senderId}:${mediaType}`;
		let seen = this.seenFrames.get(key);
		if (!seen) seen = new Set<number>();
		const hwm = this.highWaterMark.get(key) ?? -1;
		if (generation <= hwm - REPLAY_WINDOW || seen.has(generation)) return false;
		if (generation > hwm) {
			this.highWaterMark.set(key, generation);
			const pruneAtOrBefore = generation - REPLAY_WINDOW;
			for (const seenGeneration of seen) {
				if (seenGeneration <= pruneAtOrBefore) seen.delete(seenGeneration);
			}
		}
		seen.add(generation);
		this.seenFrames.set(key, seen);
		return true;
	}

	wipe(): void {
		this.meetingSecret.fill(0);
		this.signingPubs.clear();
		this.highWaterMark.clear();
		this.seenFrames.clear();
		this.frameKeyCache.clear();
	}
}

let recvState: RecvState | null = null;
let sendState: SendState | null = null;
let activeKeyVersion: number | null = null;
let activeMeetingSecret: Uint8Array<ArrayBuffer> | null = null;
let activeSenderSigningPrivateKey: CryptoKey | null = null;
let activeSenderSigningPubs: Array<[number, CryptoKey]> | null = null;
let pendingRecvPrewarm: {
	mediaType: string;
	senderSigningPubs: Array<[number, CryptoKey]>;
} | null = null;

async function applyPendingPrewarm(state: RecvState): Promise<void> {
	if (!pendingRecvPrewarm) return;
	const { mediaType, senderSigningPubs } = pendingRecvPrewarm;
	pendingRecvPrewarm = null;
	await Promise.all(
		senderSigningPubs.map(([, pub]) => state.warmSigningPub(pub)),
	);
	await state.prewarmFrameKeys(mediaType);
}

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
	if (event.data.type === "addSenderSigningPub") {
		recvState?.setSenderSigningPub(event.data.senderId, event.data.signingPub);
		if (recvState) {
			void recvState.warmSigningPub(event.data.signingPub);
		} else {
			const existing = pendingRecvPrewarm?.senderSigningPubs ?? [];
			pendingRecvPrewarm = {
				mediaType: pendingRecvPrewarm?.mediaType ?? "video",
				senderSigningPubs: [
					...existing,
					[event.data.senderId, event.data.signingPub],
				],
			};
		}
		return;
	}
	if (event.data.type === "prewarm") {
		const incoming = event.data;
		if (recvState) {
			void (async () => {
				await Promise.all(
					incoming.senderSigningPubs.map(([, pub]) =>
						recvState?.warmSigningPub(pub),
					),
				);
				await recvState.prewarmFrameKeys(incoming.mediaType);
			})();
			return;
		}
		const merged = new Map<number, CryptoKey>();
		for (const [id, pub] of pendingRecvPrewarm?.senderSigningPubs ?? []) {
			merged.set(id, pub);
		}
		for (const [id, pub] of incoming.senderSigningPubs) {
			merged.set(id, pub);
		}
		pendingRecvPrewarm = {
			mediaType: incoming.mediaType,
			senderSigningPubs: Array.from(merged.entries()),
		};
		return;
	}
	if (event.data.type === "updateContext") {
		activeKeyVersion = event.data.keyVersion;
		activeMeetingSecret = event.data.meetingSecret;
		activeSenderSigningPrivateKey = event.data.senderSigningPrivateKey ?? null;
		activeSenderSigningPubs = event.data.senderSigningPubs;
		if (sendState && event.data.senderSigningPrivateKey) {
			sendState.updateContext(
				event.data.meetingSecret,
				event.data.senderSigningPrivateKey,
			);
		}
		if (recvState) {
			recvState.updateContext(
				event.data.meetingSecret,
				event.data.senderSigningPubs,
			);
		} else {
			const merged = new Map<number, CryptoKey>();
			for (const [id, pub] of pendingRecvPrewarm?.senderSigningPubs ?? []) {
				merged.set(id, pub);
			}
			for (const [id, pub] of event.data.senderSigningPubs) {
				merged.set(id, pub);
			}
			pendingRecvPrewarm = {
				mediaType: pendingRecvPrewarm?.mediaType ?? "video",
				senderSigningPubs: Array.from(merged.entries()),
			};
		}
		return;
	}
	if (event.data.type === "wipe") {
		recvState?.wipe();
		sendState?.wipe();
		recvState = null;
		sendState = null;
		activeKeyVersion = null;
		activeMeetingSecret = null;
		activeSenderSigningPrivateKey = null;
		activeSenderSigningPubs = null;
		pendingRecvPrewarm = null;
	}
});

self.addEventListener("rtctransform", (event: Event) => {
	const transformer = (
		event as Event & {
			transformer: {
				readable: ReadableStream<EncodedFrame>;
				writable: WritableStream<EncodedFrame>;
				options: WorkerOptions;
			};
		}
	).transformer;
	const options = transformer.options;
	activeKeyVersion = activeKeyVersion ?? options.keyVersion;
	activeMeetingSecret = activeMeetingSecret ?? options.meetingSecret;
	activeSenderSigningPrivateKey =
		activeSenderSigningPrivateKey ?? options.senderSigningPrivateKey ?? null;
	activeSenderSigningPubs =
		activeSenderSigningPubs ?? options.senderSigningPubs ?? [];

	const transform = new TransformStream<EncodedFrame, EncodedFrame>({
		async transform(frame, controller) {
			if (options.direction === "send") {
				if (!activeSenderSigningPrivateKey || !activeMeetingSecret) return;
				if (!sendState) {
					sendState = new SendState(
						activeMeetingSecret,
						options.senderId,
						options.mediaType,
						activeSenderSigningPrivateKey,
					);
				}
				const encrypted = await sendState.encrypt(
					frame,
					activeKeyVersion ?? options.keyVersion,
				);
				if (encrypted) controller.enqueue(encrypted);
				return;
			}

			if (!activeMeetingSecret) return;
			if (!recvState) {
				recvState = new RecvState(
					activeMeetingSecret,
					activeSenderSigningPubs ?? [],
				);
			}
			await applyPendingPrewarm(recvState);
			const decrypted = await recvState.decrypt(
				frame,
				activeKeyVersion ?? options.keyVersion,
				options.mediaType,
			);
			if (decrypted) controller.enqueue(decrypted);
		},
	});

	transformer.readable.pipeThrough(transform).pipeTo(transformer.writable);
});
