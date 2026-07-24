import type { MeetingRecoveryState } from "../../composables/useConnectionState";

export type ClientTelemetryEvent =
	| {
			event: "first_remote_media";
			media: "audio" | "video";
			durationMs: number;
	  }
	| { event: "media_stall"; media: "audio" | "video" }
	| {
			event: "recovery";
			direction: "send" | "recv" | "both";
			trigger: "signaling" | "ice" | "stall";
			outcome: "success" | "failure";
			durationMs: number;
	  }
	| {
			event: "recovery_exhausted";
			subsystem: "signaling" | "transport" | "consumer";
			direction: "send" | "recv" | "both";
			reason: "retry_limit" | "restart_failed" | "rebuild_failed";
	  };

type TelemetryClient = {
	sendClientTelemetry(event: ClientTelemetryEvent): void;
};

const SAMPLE_RATE = 0.05;
const reporters = new WeakMap<object, ClientTelemetry>();

export class ClientTelemetry {
	private startedAt: number;
	private recoveryStartedAt: number | null = null;
	private recoveryDirections = new Set<"send" | "recv">();
	private recoveryTrigger: "signaling" | "ice" | "stall" = "ice";
	private firstMedia = new Set<"audio" | "video">();

	constructor(
		private client: TelemetryClient,
		private sampled = Math.random() < SAMPLE_RATE,
		private now: () => number = () => performance.now(),
	) {
		this.startedAt = this.now();
	}

	startSession(): void {
		this.startedAt = this.now();
		this.firstMedia.clear();
		this.recoveryStartedAt = null;
		this.recoveryDirections.clear();
		this.recoveryTrigger = "ice";
	}

	markFirstRemoteMedia(media: "audio" | "video"): void {
		if (this.firstMedia.has(media)) return;
		this.firstMedia.add(media);
		this.send({
			event: "first_remote_media",
			media,
			durationMs: this.elapsed(this.startedAt),
		});
	}

	reportMediaStalls(media: Iterable<"audio" | "video">): void {
		for (const kind of new Set(media)) {
			this.send({ event: "media_stall", media: kind });
		}
	}

	reportRecoveryExhausted(event: Omit<Extract<ClientTelemetryEvent, {
		event: "recovery_exhausted";
	}>, "event">): void {
		this.send({ event: "recovery_exhausted", ...event });
	}

	recordRecoveryState(
		state: MeetingRecoveryState,
		detail?: string,
	): void {
		if (state === "healthy" || state === "failed") {
			if (this.recoveryStartedAt === null) return;
			this.send({
				event: "recovery",
				direction: this.recoveryDirection(),
				trigger: this.recoveryTrigger,
				outcome: state === "healthy" ? "success" : "failure",
				durationMs: this.elapsed(this.recoveryStartedAt),
			});
			if (state === "failed") {
				this.reportRecoveryExhausted({
					subsystem:
						this.recoveryTrigger === "signaling" ? "signaling" : "transport",
					direction: this.recoveryDirection(),
					reason:
						this.recoveryTrigger === "signaling" ? "retry_limit" : "rebuild_failed",
				});
			}
			this.recoveryStartedAt = null;
			this.recoveryDirections.clear();
			this.recoveryTrigger = "ice";
			return;
		}

		this.recoveryStartedAt ??= this.now();
		if (state === "recovering_send") this.recoveryDirections.add("send");
		if (state === "recovering_receive") this.recoveryDirections.add("recv");
		if (state === "reconnecting" || state === "rejoining") {
			this.recoveryDirections.add("send");
			this.recoveryDirections.add("recv");
			this.recoveryTrigger = "signaling";
		} else if (detail?.startsWith("consumer_stall_")) {
			this.recoveryTrigger = "stall";
		}
	}

	private recoveryDirection(): "send" | "recv" | "both" {
		if (this.recoveryDirections.size !== 1) return "both";
		return this.recoveryDirections.has("send") ? "send" : "recv";
	}

	private elapsed(startedAt: number): number {
		return Math.max(0, Math.min(300_000, Math.round(this.now() - startedAt)));
	}

	private send(event: ClientTelemetryEvent): void {
		if (!this.sampled) return;
		try {
			this.client.sendClientTelemetry(event);
		} catch {
			// Telemetry must never affect the meeting.
		}
	}
}

export function getClientTelemetry(client: TelemetryClient & object): ClientTelemetry {
	let reporter = reporters.get(client);
	if (!reporter) {
		reporter = new ClientTelemetry(client);
		reporters.set(client, reporter);
	}
	return reporter;
}
