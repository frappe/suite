import type { RecordingProofChallenge } from "../../suite/meet/types";

export interface RecorderConfig {
	job: string;
	grant: string;
	meetingId: string;
	sfuOrigin: string;
	frappeOrigin: string;
	socketPath: string;
	acceptedAt: string;
	publicChat?: boolean;
}

export type RecordingChallenge = RecordingProofChallenge;

export const RECORDER_PROTOCOL_VERSION = 1 as const;

export type RendererReasonCode =
	| "sfu_disconnected"
	| "media_attachment_failed"
	| "media_subscription_failed"
	| "receive_transport_failed"
	| "projection_invalid"
	| "configuration_failed"
	| "browser_disconnected"
	| "page_crashed";

type RendererReport =
	| { type: "suite-recorder:capture-ready" }
	| {
			type: "suite-recorder:interruption";
			reason_code: RendererReasonCode;
			diagnostic?: string;
	  }
	| { type: "suite-recorder:proof-complete" }
	| { type: "suite-recorder:join-complete" }
	| { type: "suite-recorder:room-empty" }
	| {
			type: "suite-recorder:failure";
			reason_code: RendererReasonCode;
			diagnostic?: string;
	  };

export type PrepareCaptureCommand = {
	type: "suite-recorder:prepare-capture";
	protocol_version: 1;
	job: string;
	epoch: number;
};

export type CaptureStartedCommand = {
	type: "suite-recorder:capture-started";
	protocol_version: 1;
	job: string;
	epoch: number;
	capture_started_at: string;
};

export interface CaptureCommandController {
	prepareCapture(epoch: number): Promise<void>;
	captureStarted(epoch: number, timestamp: string): Promise<void>;
	failCaptureCommand(reason: string): void;
}

export class CaptureCommandSupersededError extends Error {
	constructor() {
		super("Capture command superseded");
		this.name = "CaptureCommandSupersededError";
	}
}

export type OutboundRendererMessage =
	| {
			type: "suite-recorder:public-key-ready";
			protocol_version: 1;
			occurred_at: string;
			publicKey: JsonWebKey;
	  }
	| {
			type: "suite-recorder:configuration-accepted";
			protocol_version: 1;
			occurred_at: string;
			job: string;
	  }
	  | (RendererReport & {
			protocol_version: 1;
			occurred_at: string;
			job: string;
	  })
	| {
			type: "suite-recorder:capture-prepared";
			protocol_version: 1;
			occurred_at: string;
			job: string;
			epoch: number;
	  }
	| {
			type: "suite-recorder:capture-started-accepted";
			protocol_version: 1;
			occurred_at: string;
			job: string;
			epoch: number;
			capture_started_at: string;
	  };

export const canonicalChallenge = (
	challenge: RecordingChallenge,
): Uint8Array<ArrayBuffer> =>
	new TextEncoder().encode(
		`meet-recording-proof-v1\n${challenge.jti}\n${challenge.socket_id}\n${challenge.nonce}\n${challenge.issued_at}\n${challenge.expires_at}`,
	);

const base64url = (bytes: ArrayBuffer): string => {
	let binary = "";
	for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
};

export class RecorderRendererBridge {
	private privateKey?: CryptoKey;
	private configured = false;
	private job?: string;

	private post(
		message: OutboundRendererMessage,
		target: Pick<Window, "postMessage"> = window,
	): void {
		target.postMessage(message, window.location.origin);
	}

	async initialize(
		target: Pick<Window, "postMessage"> = window,
	): Promise<JsonWebKey> {
		const pair = (await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["sign", "verify"],
		)) as CryptoKeyPair;
		this.privateKey = pair.privateKey;
		const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
		const publicKey = {
			kty: exported.kty,
			crv: exported.crv,
			x: exported.x,
			y: exported.y,
		};
		this.post(
			{
				type: "suite-recorder:public-key-ready",
				protocol_version: RECORDER_PROTOCOL_VERSION,
				occurred_at: new Date().toISOString(),
				publicKey,
			},
			target,
		);
		return publicKey;
	}

	waitForConfig(
		source: Pick<Window, "addEventListener" | "removeEventListener"> = window,
	): Promise<RecorderConfig> {
		return new Promise((resolve) => {
			const receive = (event: MessageEvent) => {
				if (
					this.configured ||
					event.source !== window ||
					event.origin !== window.location.origin
				)
					return;
				const message = parseConfigureMessage(event.data);
				if (!message) return;
				this.configured = true;
				this.job = message.config.job;
				source.removeEventListener("message", receive as EventListener);
				this.post({
					type: "suite-recorder:configuration-accepted",
					protocol_version: RECORDER_PROTOCOL_VERSION,
					occurred_at: new Date().toISOString(),
					job: this.job,
				});
				resolve(Object.freeze({ ...message.config }));
			};
			source.addEventListener("message", receive as EventListener);
		});
	}

	bindCaptureCommands(
		controller: CaptureCommandController,
		source: Pick<Window, "addEventListener" | "removeEventListener"> = window,
	): () => void {
		let bound = true;
		const receive = (event: MessageEvent) => {
			if (
				event.source !== window ||
				event.origin !== window.location.origin ||
				!this.job
			)
				return;
			const type =
				event.data && typeof event.data === "object" && "type" in event.data
					? event.data.type
					: undefined;
			if (
				type !== "suite-recorder:prepare-capture" &&
				type !== "suite-recorder:capture-started"
			)
				return;
			const prepare = parsePrepareCaptureMessage(event.data);
			const started = parseCaptureStartedMessage(event.data);
			if ((!prepare && !started) || (prepare ?? started)?.job !== this.job) {
				failClosed("Invalid recorder capture command");
				return;
			}
			const operation = prepare
				? controller.prepareCapture(prepare.epoch).then(() => {
						this.reportCapturePrepared(prepare.epoch);
					})
				: controller
						.captureStarted(started.epoch, started.capture_started_at)
						.then(() => {
							this.reportCaptureStartedAccepted(
								started.epoch,
								started.capture_started_at,
							);
						});
			void operation.catch((error: unknown) => {
				if (error instanceof CaptureCommandSupersededError) return;
				failClosed(
					error instanceof Error ? error.message : "Capture command failed",
				);
			});
		};
		const unbind = () => {
			if (!bound) return;
			bound = false;
			source.removeEventListener("message", receive as EventListener);
		};
		const failClosed = (diagnostic: string) => {
			unbind();
			controller.failCaptureCommand(diagnostic);
		};
		source.addEventListener("message", receive as EventListener);
		return unbind;
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
		this.report({ type: "suite-recorder:capture-ready" }, target);
	}

	reportInterruption(
		reasonCode: RendererReasonCode,
		diagnostic?: string,
		target: Pick<Window, "postMessage"> = window,
	): void {
		this.report(
			{
				type: "suite-recorder:interruption",
				reason_code: reasonCode,
				...boundedDiagnostic(diagnostic),
			},
			target,
		);
	}

	reportProofComplete(target: Pick<Window, "postMessage"> = window): void {
		this.report({ type: "suite-recorder:proof-complete" }, target);
	}

	reportJoinComplete(target: Pick<Window, "postMessage"> = window): void {
		this.report({ type: "suite-recorder:join-complete" }, target);
	}

	reportRoomEmpty(target: Pick<Window, "postMessage"> = window): void {
		this.report({ type: "suite-recorder:room-empty" }, target);
	}

	reportFailure(
		reasonCode: RendererReasonCode,
		diagnostic?: string,
		target: Pick<Window, "postMessage"> = window,
	): void {
		this.report(
			{
				type: "suite-recorder:failure",
				reason_code: reasonCode,
				...boundedDiagnostic(diagnostic),
			},
			target,
		);
	}

	private reportCapturePrepared(epoch: number): void {
		if (!this.job) return;
		this.post({
			type: "suite-recorder:capture-prepared",
			protocol_version: RECORDER_PROTOCOL_VERSION,
			occurred_at: new Date().toISOString(),
			job: this.job,
			epoch,
		});
	}

	private reportCaptureStartedAccepted(
		epoch: number,
		captureStartedAt: string,
	): void {
		if (!this.job) return;
		this.post({
			type: "suite-recorder:capture-started-accepted",
			protocol_version: RECORDER_PROTOCOL_VERSION,
			occurred_at: new Date().toISOString(),
			job: this.job,
			epoch,
			capture_started_at: captureStartedAt,
		});
	}

	private report(
		message: RendererReport,
		target: Pick<Window, "postMessage">,
	): void {
		if (!this.job) return;
		this.post(
			{
				...message,
				protocol_version: RECORDER_PROTOCOL_VERSION,
				occurred_at: new Date().toISOString(),
				job: this.job,
			},
			target,
		);
	}
}

const boundedDiagnostic = (diagnostic?: string): { diagnostic?: string } =>
	diagnostic ? { diagnostic: diagnostic.slice(0, 256) } : {};

const hasExactKeys = (
	value: object,
	required: string[],
	optional: string[] = [],
): boolean => {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
};

const isHttpUrl = (value: string): boolean => {
	try {
		return ["http:", "https:"].includes(new URL(value).protocol);
	} catch {
		return false;
	}
};

const isUtcTimestamp = (value: unknown): value is string => {
	if (
		typeof value !== "string" ||
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
	)
		return false;
	const parsed = new Date(value);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const parseConfig = (value: unknown): RecorderConfig | null => {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!hasExactKeys(
			value,
			[
				"job",
				"grant",
				"meetingId",
				"sfuOrigin",
				"frappeOrigin",
				"socketPath",
				"acceptedAt",
			],
			["publicChat"],
		)
	)
		return null;
	if (
		!("job" in value) ||
		typeof value.job !== "string" ||
		!value.job ||
		!("grant" in value) ||
		typeof value.grant !== "string" ||
		!value.grant ||
		!("meetingId" in value) ||
		typeof value.meetingId !== "string" ||
		!value.meetingId ||
		!("sfuOrigin" in value) ||
		typeof value.sfuOrigin !== "string" ||
		!isHttpUrl(value.sfuOrigin) ||
		!("frappeOrigin" in value) ||
		typeof value.frappeOrigin !== "string" ||
		!isHttpUrl(value.frappeOrigin) ||
		!("socketPath" in value) ||
		typeof value.socketPath !== "string" ||
		!value.socketPath ||
		!("acceptedAt" in value) ||
		!isUtcTimestamp(value.acceptedAt) ||
		("publicChat" in value && typeof value.publicChat !== "boolean")
	)
		return null;
	return {
		job: value.job,
		grant: value.grant,
		meetingId: value.meetingId,
		sfuOrigin: value.sfuOrigin,
		frappeOrigin: value.frappeOrigin,
		socketPath: value.socketPath,
		acceptedAt: value.acceptedAt,
		...("publicChat" in value && typeof value.publicChat === "boolean"
			? { publicChat: value.publicChat }
			: {}),
	};
};

export const parseConfigureMessage = (
	value: unknown,
): { type: "suite-recorder:configure"; config: RecorderConfig } | null => {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!hasExactKeys(value, ["type", "protocol_version", "config"]) ||
		!("type" in value) ||
		value.type !== "suite-recorder:configure" ||
		!("protocol_version" in value) ||
		value.protocol_version !== RECORDER_PROTOCOL_VERSION ||
		!("config" in value)
	)
		return null;
	const config = parseConfig(value.config);
	return config ? { type: value.type, config } : null;
};

export const parsePrepareCaptureMessage = (
	value: unknown,
): PrepareCaptureCommand | null => {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!hasExactKeys(value, ["type", "protocol_version", "job", "epoch"]) ||
		!("type" in value) ||
		value.type !== "suite-recorder:prepare-capture" ||
		!("protocol_version" in value) ||
		value.protocol_version !== RECORDER_PROTOCOL_VERSION ||
		!("job" in value) ||
		typeof value.job !== "string" ||
		!value.job ||
		!("epoch" in value) ||
		!Number.isSafeInteger(value.epoch) ||
		Number(value.epoch) < 0
	)
		return null;
	return {
		type: value.type,
		protocol_version: RECORDER_PROTOCOL_VERSION,
		job: value.job,
		epoch: value.epoch as number,
	};
};

export const parseCaptureStartedMessage = (
	value: unknown,
): CaptureStartedCommand | null => {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		!hasExactKeys(value, [
			"type",
			"protocol_version",
			"job",
			"epoch",
			"capture_started_at",
		]) ||
		!("type" in value) ||
		value.type !== "suite-recorder:capture-started" ||
		!("protocol_version" in value) ||
		value.protocol_version !== RECORDER_PROTOCOL_VERSION ||
		!("job" in value) ||
		typeof value.job !== "string" ||
		!value.job ||
		!("epoch" in value) ||
		!Number.isSafeInteger(value.epoch) ||
		Number(value.epoch) < 0 ||
		!("capture_started_at" in value) ||
		!isUtcTimestamp(value.capture_started_at)
	)
		return null;
	return {
		type: value.type,
		protocol_version: RECORDER_PROTOCOL_VERSION,
		job: value.job,
		epoch: value.epoch as number,
		capture_started_at: value.capture_started_at,
	};
};
