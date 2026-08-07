export interface RecorderConfig {
	job: string;
	grant: string;
	meetingId: string;
	sfuOrigin: string;
	frappeOrigin: string;
	socketPath: string;
	startedAt: number;
	publicChat?: boolean;
}

export interface RecordingChallenge {
	version: 1;
	jti: string;
	socket_id: string;
	nonce: string;
	issued_at: number;
	expires_at: number;
}

export const canonicalChallenge = (challenge: RecordingChallenge): Uint8Array =>
	new TextEncoder().encode(`meet-recording-proof-v1\n${challenge.jti}\n${challenge.socket_id}\n${challenge.nonce}\n${challenge.issued_at}\n${challenge.expires_at}`);

const base64url = (bytes: ArrayBuffer): string => {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export class RecorderRendererBridge {
	private privateKey?: CryptoKey;
	private configured = false;
	private job?: string;

	private post(message: Record<string, unknown>, target: Pick<Window, "postMessage"> = window): void {
		target.postMessage(message, window.location.origin);
	}

	async initialize(target: Pick<Window, "postMessage"> = window): Promise<JsonWebKey> {
		const pair = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign", "verify"],
		) as CryptoKeyPair;
		this.privateKey = pair.privateKey;
		const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
		this.post({ type: "suite-recorder:public-key-ready", publicKey }, target);
		return publicKey;
	}

	waitForConfig(source: Pick<Window, "addEventListener" | "removeEventListener"> = window): Promise<RecorderConfig> {
		return new Promise((resolve) => {
			const receive = (event: MessageEvent) => {
				if (this.configured || event.source !== window || event.origin !== window.location.origin) return;
				const message = event.data as { type?: string; config?: RecorderConfig };
				if (message?.type !== "suite-recorder:configure" || !isConfig(message.config)) return;
				this.configured = true;
				this.job = message.config.job;
				source.removeEventListener("message", receive as EventListener);
				this.post({ type: "suite-recorder:configuration-accepted", job: this.job });
				resolve(Object.freeze({ ...message.config }));
			};
			source.addEventListener("message", receive as EventListener);
		});
	}

	async sign(challenge: RecordingChallenge): Promise<string> {
		if (!this.privateKey) throw new Error("Recorder bridge is not initialized");
		const signature = await crypto.subtle.sign(
			{ name: "ECDSA", hash: "SHA-256" },
			this.privateKey,
			canonicalChallenge(challenge),
		);
		return base64url(signature);
	}

	reportCaptureReady(target: Pick<Window, "postMessage"> = window): void {
		this.report("capture-ready", {}, target);
	}

	reportInterruption(reason: string, target: Pick<Window, "postMessage"> = window): void {
		this.report("interruption", { reason }, target);
	}

	reportProofComplete(target: Pick<Window, "postMessage"> = window): void {
		this.report("proof-complete", {}, target);
	}

	reportJoinComplete(target: Pick<Window, "postMessage"> = window): void {
		this.report("join-complete", {}, target);
	}

	reportRoomEmpty(target: Pick<Window, "postMessage"> = window): void {
		this.report("room-empty", {}, target);
	}

	reportFailure(reason: string, target: Pick<Window, "postMessage"> = window): void {
		this.report("failure", { reason }, target);
	}

	private report(type: string, fields: Record<string, unknown>, target: Pick<Window, "postMessage">): void {
		if (!this.job) return;
		this.post({ type: `suite-recorder:${type}`, job: this.job, ...fields }, target);
	}
}

const isConfig = (value: unknown): value is RecorderConfig => {
	if (!value || typeof value !== "object") return false;
	const config = value as Record<string, unknown>;
	return ["job", "grant", "meetingId", "sfuOrigin", "frappeOrigin", "socketPath"].every((key) => typeof config[key] === "string" && config[key] !== "") && typeof config.startedAt === "number";
};
