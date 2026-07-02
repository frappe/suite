// E2EE meeting state manager.
//
// Holds all per-meeting E2EE state: the meeting secret, per-sender key
// chains, active transforms, and the chat key cache.  Access via the
// module-level singleton (E2EEMeeting.instance) or instantiate directly
// in tests.

import {
	notifyE2EEContextReady,
	resetE2EEContextReady,
} from "./E2EEContextReady";
import {
	createDecryptionTransformStream,
	createEncryptionTransformStream,
	getE2EETransformCapability,
	ReceiverChainState,
	type ReceiverWithInsertableStreams,
	SenderChainState,
	type SenderWithInsertableStreams,
	type TransformableReceiver,
	type TransformableSender,
} from "./e2ee";
import { encodeInfo, INFO_CHAT } from "./e2eePrimitives";

function getSubtle(): SubtleCrypto {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error("SubtleCrypto not available");
	return subtle;
}

interface PendingSender {
	sender: RTCRtpSender;
	senderId: number;
	mediaType: string;
}

interface PendingReceiver {
	receiver: RTCRtpReceiver;
	senderId: number;
	mediaType: string;
}

export class E2EEMeeting {
	private static _instance: E2EEMeeting | null = null;

	static get instance(): E2EEMeeting {
		if (!E2EEMeeting._instance) {
			E2EEMeeting._instance = new E2EEMeeting();
		}
		return E2EEMeeting._instance;
	}

	static set instance(val: E2EEMeeting | null) {
		E2EEMeeting._instance = val;
	}

	private meetingSecret: Uint8Array<ArrayBuffer> | null = null;
	private keyVersion: number | null = null;
	private senderSigningPriv: CryptoKey | null = null;
	private readonly senderChains = new Map<string, SenderChainState>();
	private readonly senderSigningPubs = new Map<number, CryptoKey>();
	private receiverChain: ReceiverChainState | null = null;
	private readonly pendingSenders = new Set<PendingSender>();
	private readonly pendingReceivers = new Set<PendingReceiver>();
	private readonly activeSenderTransforms = new WeakSet<RTCRtpSender>();
	private readonly activeReceiverTransforms = new WeakSet<RTCRtpReceiver>();
	private readonly scriptTransformWorkers = new Set<Worker>();
	private chatKeyCache: {
		meetingSecretVersion: number;
		key: CryptoKey;
	} | null = null;
	private readonly preCreatedReceiverStreams = new WeakMap<
		RTCRtpReceiver,
		{ readable: ReadableStream<unknown>; writable: WritableStream<unknown> }
	>();

	setMeetingContext(
		meetingSecretArg: Uint8Array<ArrayBuffer>,
		keyVersionArg: number,
		senderSigningPrivArg?: CryptoKey,
	): void {
		this.meetingSecret = meetingSecretArg;
		this.keyVersion = keyVersionArg;
		this.senderSigningPriv = senderSigningPrivArg ?? null;
		if (this.senderSigningPriv) {
			for (const chain of this.senderChains.values()) {
				chain.updateContext(
					new Uint8Array(meetingSecretArg),
					this.senderSigningPriv,
				);
			}
		} else {
			for (const chain of this.senderChains.values()) {
				chain.wipe();
			}
			this.senderChains.clear();
		}
		this.receiverChain?.updateContext(new Uint8Array(meetingSecretArg));
		this.updateActiveScriptTransforms();
		void this.setupPendingTransforms();
		notifyE2EEContextReady();
	}

	hasMeetingContext(): boolean {
		return this.meetingSecret !== null && this.keyVersion !== null;
	}

	async getSessionFingerprint(): Promise<string | null> {
		if (!this.meetingSecret || this.keyVersion === null) return null;
		const subtle = getSubtle();
		const prefix = new TextEncoder().encode(
			`meet-e2ee-session|${this.keyVersion}|`,
		);
		const input = new Uint8Array(prefix.length + this.meetingSecret.length);
		input.set(prefix, 0);
		input.set(this.meetingSecret, prefix.length);
		const digest = await subtle.digest("SHA-256", input);
		return Array.from(new Uint8Array(digest))
			.slice(0, 16)
			.map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
			.join("")
			.match(/.{1,4}/g)
			?.join(" ") ?? null;
	}

	setSenderSigningPub(senderId: number, signingPub: CryptoKey): void {
		this.senderSigningPubs.set(senderId, signingPub);
		this.receiverChain?.setSenderSigningPub(senderId, signingPub);
		for (const worker of this.scriptTransformWorkers) {
			worker.postMessage({ type: "addSenderSigningPub", senderId, signingPub });
		}
	}

	private updateActiveScriptTransforms(): void {
		if (!this.meetingSecret || this.keyVersion === null) return;
		for (const worker of this.scriptTransformWorkers) {
			worker.postMessage({
				type: "updateContext",
				meetingSecret: new Uint8Array(this.meetingSecret),
				keyVersion: this.keyVersion,
				senderSigningPrivateKey: this.senderSigningPriv ?? undefined,
				senderSigningPubs: Array.from(this.senderSigningPubs.entries()),
			});
		}
	}

	hasSenderSigningPub(senderId: number): boolean {
		return (
			this.receiverChain?.hasSenderSigningPub(senderId) ??
			this.senderSigningPubs.has(senderId)
		);
	}

	wipeMeetingContext(): void {
		if (this.meetingSecret) {
			this.meetingSecret.fill(0);
		}
		this.meetingSecret = null;
		this.keyVersion = null;
		this.senderSigningPriv = null;
		for (const chain of this.senderChains.values()) {
			chain.wipe();
		}
		this.senderChains.clear();
		if (this.receiverChain) {
			this.receiverChain.wipe();
			this.receiverChain = null;
		}
		this.pendingSenders.clear();
		this.pendingReceivers.clear();
		this.senderSigningPubs.clear();
		for (const worker of this.scriptTransformWorkers) {
			worker.postMessage({ type: "wipe" });
		}
		this.scriptTransformWorkers.clear();
		this.chatKeyCache = null;
		resetE2EEContextReady();
	}

	async getE2EEChatKey(): Promise<CryptoKey | null> {
		if (!this.meetingSecret) return null;
		if (
			this.chatKeyCache &&
			this.chatKeyCache.meetingSecretVersion === this.keyVersion
		) {
			return this.chatKeyCache.key;
		}
		const subtle = getSubtle();
		const ikm = this.meetingSecret;
		const salt = new Uint8Array(32);
		const info = encodeInfo(INFO_CHAT);
		const hkdfKey = await subtle.importKey(
			"raw",
			ikm as BufferSource,
			"HKDF",
			false,
			["deriveBits"],
		);
		const bits = await subtle.deriveBits(
			{ name: "HKDF", hash: "SHA-256", salt, info: info as BufferSource },
			hkdfKey,
			256,
		);
		const key = await subtle.importKey(
			"raw",
			bits,
			{ name: "AES-GCM" },
			false,
			["encrypt", "decrypt"],
		);
		this.chatKeyCache = { meetingSecretVersion: this.keyVersion, key };
		return key;
	}

	private getOrCreateSenderChain(
		senderId: number,
		mediaType: string,
	): SenderChainState | null {
		if (!this.meetingSecret) {
			return null;
		}
		if (!this.senderSigningPriv) {
			console.warn(
				"[E2EE] getOrCreateSenderChain: no sender signing key (deferring)",
			);
			return null;
		}
		const key = `${senderId}:${mediaType}`;
		let chain = this.senderChains.get(key);
		if (!chain) {
			chain = new SenderChainState(
				this.meetingSecret,
				senderId,
				mediaType,
				this.senderSigningPriv,
			);
			this.senderChains.set(key, chain);
		}
		return chain;
	}

	private getOrCreateReceiverChain(): ReceiverChainState | null {
		if (!this.meetingSecret) {
			return null;
		}
		if (!this.receiverChain) {
			this.receiverChain = new ReceiverChainState(this.meetingSecret);
			for (const [senderId, pub] of this.senderSigningPubs) {
				this.receiverChain.setSenderSigningPub(senderId, pub);
			}
		}
		return this.receiverChain;
	}

	preCreateReceiverStreams(receiver: RTCRtpReceiver): boolean {
		const capability = getE2EETransformCapability();
		if (capability === "none") {
			console.warn(
				"[E2EE] preCreateReceiverStreams: no insertable stream support",
			);
			return false;
		}
		if (capability === "rtp-script-transform") {
			return true;
		}
		if (this.preCreatedReceiverStreams.has(receiver)) {
			return true;
		}
		const streams = (
			receiver as ReceiverWithInsertableStreams
		).createEncodedStreams?.();
		if (!streams) {
			console.warn(
				"[E2EE] preCreateReceiverStreams: createEncodedStreams returned null",
			);
			return false;
		}
		const readable = streams.readable || streams.readableStream;
		const writable = streams.writable || streams.writableStream;
		if (!readable || !writable) {
			console.warn(
				"[E2EE] preCreateReceiverStreams: missing readable/writable",
			);
			return false;
		}
		this.preCreatedReceiverStreams.set(receiver, { readable, writable });
		return true;
	}

	async setupSenderTransform(
		sender: RTCRtpSender | undefined,
		senderId: number,
		mediaType: string,
	): Promise<boolean> {
		if (!sender) {
			return false;
		}
		const capability = getE2EETransformCapability();
		if (
			this.activeSenderTransforms.has(sender) &&
			capability !== "rtp-script-transform"
		) {
			return false;
		}
		if (capability === "none") {
			console.warn(
				"[E2EE] setupSenderTransform: insertable stream support missing",
			);
			return false;
		}
		if (!this.hasMeetingContext()) {
			console.warn(
				"[E2EE] setupSenderTransform: no meeting context (deferring)",
				{ senderId, mediaType },
			);
			this.pendingSenders.add({ sender, senderId, mediaType });
			return false;
		}
		const senderKeyVersion = this.keyVersion;
		if (senderKeyVersion == null) return false;
		if (capability === "rtp-script-transform") {
			if (!this.meetingSecret || !this.senderSigningPriv) {
				this.pendingSenders.add({ sender, senderId, mediaType });
				return false;
			}
			const worker = this.installScriptTransform(
				sender as TransformableSender,
				{
					direction: "send",
					meetingSecret: new Uint8Array(this.meetingSecret),
					keyVersion: senderKeyVersion,
					senderId,
					mediaType,
					senderSigningPrivateKey: this.senderSigningPriv,
				},
			);
			const installed = worker !== null;
			if (installed) {
				this.activeSenderTransforms.add(sender);
				this.postTransformWorkerPrewarm(worker as Worker, { mediaType });
			}
			return installed;
		}
		const chain = this.getOrCreateSenderChain(senderId, mediaType);
		if (!chain) {
			console.warn("[E2EE] setupSenderTransform: chain is null");
			return false;
		}
		const streams = (
			sender as SenderWithInsertableStreams
		).createEncodedStreams?.();
		if (!streams) {
			console.warn(
				"[E2EE] setupSenderTransform: createEncodedStreams returned nothing",
				{
					senderId,
					mediaType,
					hasProto: typeof (sender as SenderWithInsertableStreams)
						.createEncodedStreams,
				},
			);
			return false;
		}
		const readable = streams.readable || streams.readableStream;
		const writable = streams.writable || streams.writableStream;
		if (!readable || !writable) return false;
		try {
			readable
				.pipeThrough(
					createEncryptionTransformStream(
						chain,
						() => this.keyVersion ?? senderKeyVersion,
					),
				)
				.pipeTo(writable)
				.catch((error: unknown) => {
					console.warn("E2EE sender transform pipeline failed:", error);
				});
			this.activeSenderTransforms.add(sender);
			return true;
		} catch (error) {
			console.error("E2EE: Failed to setup sender transform:", error);
			return false;
		}
	}

	async setupReceiverTransform(
		receiver: RTCRtpReceiver | undefined,
		senderId: number,
		mediaType: string,
	): Promise<boolean> {
		if (!receiver) {
			console.warn("[E2EE] setupReceiverTransform: no receiver");
			return false;
		}
		if (this.activeReceiverTransforms.has(receiver)) {
			console.warn("[E2EE] setupReceiverTransform: already active", {
				senderId,
				mediaType,
			});
			return false;
		}
		const capability = getE2EETransformCapability();
		if (capability === "none") {
			console.warn(
				"[E2EE] setupReceiverTransform: no insertable stream support",
			);
			return false;
		}
		if (!this.hasMeetingContext()) {
			this.pendingReceivers.add({ receiver, senderId, mediaType });
			return false;
		}
		const receiverKeyVersion = this.keyVersion;
		if (receiverKeyVersion == null) return false;
		if (capability === "rtp-script-transform") {
			if (!this.meetingSecret) return false;
			const worker = this.installScriptTransform(
				receiver as TransformableReceiver,
				{
					direction: "recv",
					meetingSecret: new Uint8Array(this.meetingSecret),
					keyVersion: receiverKeyVersion,
					senderId,
					mediaType,
					senderSigningPubs: Array.from(this.senderSigningPubs.entries()),
				},
			);
			const installed = worker !== null;
			if (installed) {
				this.activeReceiverTransforms.add(receiver);
				this.postTransformWorkerPrewarm(worker as Worker, {
					mediaType,
					senderSigningPubs: Array.from(this.senderSigningPubs.entries()),
				});
			}
			return installed;
		}
		const chain = this.getOrCreateReceiverChain();
		if (!chain) {
			console.warn("[E2EE] setupReceiverTransform: chain is null");
			return false;
		}
		let readable: ReadableStream<unknown> | undefined;
		let writable: WritableStream<unknown> | undefined;
		const preCreated = this.preCreatedReceiverStreams.get(receiver);
		if (preCreated) {
			readable = preCreated.readable;
			writable = preCreated.writable;
		} else {
			const streams = (
				receiver as ReceiverWithInsertableStreams
			).createEncodedStreams?.();
			if (!streams) {
				console.warn(
					"[E2EE] setupReceiverTransform: createEncodedStreams returned null",
					{ senderId, mediaType },
				);
				return false;
			}
			readable = streams.readable || streams.readableStream;
			writable = streams.writable || streams.writableStream;
		}
		if (!readable || !writable) {
			console.warn("[E2EE] setupReceiverTransform: missing readable/writable", {
				senderId,
				mediaType,
				hasReadable: !!readable,
				hasWritable: !!writable,
			});
			return false;
		}
		try {
			readable
				.pipeThrough(
					createDecryptionTransformStream(
						chain,
						() => this.keyVersion ?? receiverKeyVersion,
						receiver,
						mediaType,
					),
				)
				.pipeTo(writable)
				.catch((error: unknown) => {
					console.warn("E2EE receiver transform pipeline failed:", error);
				});
			this.activeReceiverTransforms.add(receiver);
			return true;
		} catch (error) {
			console.error("E2EE: Failed to setup receiver transform:", error);
			return false;
		}
	}

	private async setupPendingTransforms(): Promise<void> {
		for (const pending of Array.from(this.pendingSenders)) {
			const ok = await this.setupSenderTransform(
				pending.sender,
				pending.senderId,
				pending.mediaType,
			);
			if (ok) this.pendingSenders.delete(pending);
		}
		for (const pending of Array.from(this.pendingReceivers)) {
			const ok = await this.setupReceiverTransform(
				pending.receiver,
				pending.senderId,
				pending.mediaType,
			);
			if (ok) this.pendingReceivers.delete(pending);
		}
	}

	private createE2EEWorker(): Worker {
		const worker = new Worker(
			new URL("./e2eeTransformWorker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		this.scriptTransformWorkers.add(worker);
		return worker;
	}

	private postTransformWorkerPrewarm(
		worker: Worker,
		payload: {
			mediaType: string;
			senderSigningPubs?: Array<[number, CryptoKey]>;
		},
	): void {
		try {
			worker.postMessage({
				type: "prewarm",
				mediaType: payload.mediaType,
				senderSigningPubs: payload.senderSigningPubs ?? [],
			});
		} catch {
			// best-effort: a failed pre-warm post is not fatal
		}
	}

	private installScriptTransform(
		target: TransformableSender | TransformableReceiver,
		options: Record<string, unknown>,
	): Worker | null {
		const RTCRtpScriptTransform = this.getRTCRtpScriptTransform();
		if (!RTCRtpScriptTransform) return null;
		const worker = this.createE2EEWorker();
		target.transform = new RTCRtpScriptTransform(worker, options);
		return worker;
	}

	private getRTCRtpScriptTransform(): RTCRtpScriptTransformConstructor | null {
		return (
			(
				globalThis as typeof globalThis & {
					RTCRtpScriptTransform?: RTCRtpScriptTransformConstructor;
				}
			).RTCRtpScriptTransform ?? null
		);
	}
}

type RTCRtpScriptTransformConstructor = new (
	worker: Worker,
	options: Record<string, unknown>,
) => unknown;
