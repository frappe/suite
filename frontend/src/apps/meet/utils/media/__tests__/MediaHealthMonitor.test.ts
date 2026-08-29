import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsumerEntry } from "../ConsumerManager";
import {
	MediaHealthMonitor,
	type MediaHealthEnvironment,
	type MediaHealthManager,
} from "../MediaHealthMonitor";

type LifecycleEvent = "offline" | "online" | "pageshow";
type Listener = () => void | Promise<void>;

class TestEnvironment implements MediaHealthEnvironment {
	nowValue = 1_000_000;
	hidden = false;
	online = true;
	private poll: Listener | null = null;
	private visibilityListeners = new Set<Listener>();
	private lifecycleListeners = new Map<LifecycleEvent, Set<Listener>>();

	now = () => this.nowValue;
	isHidden = () => this.hidden;
	isOnline = () => this.online;

	setInterval(callback: Listener): unknown {
		this.poll = callback;
		return callback;
	}

	clearInterval(handle: unknown): void {
		if (this.poll === handle) this.poll = null;
	}

	onVisibilityChange(listener: Listener): () => void {
		this.visibilityListeners.add(listener);
		return () => this.visibilityListeners.delete(listener);
	}

	onLifecycleEvent(event: LifecycleEvent, listener: Listener): () => void {
		const listeners = this.lifecycleListeners.get(event) ?? new Set();
		listeners.add(listener);
		this.lifecycleListeners.set(event, listeners);
		return () => listeners.delete(listener);
	}

	async advance(durationMs: number): Promise<void> {
		for (let elapsed = 0; elapsed < durationMs; elapsed += 3000) {
			this.nowValue += 3000;
			await this.poll?.();
		}
	}

	async setHidden(hidden: boolean): Promise<void> {
		this.hidden = hidden;
		await Promise.all(
			[...this.visibilityListeners].map((listener) => listener()),
		);
		await Promise.resolve();
	}

	async setOnline(online: boolean): Promise<void> {
		this.online = online;
		const event = online ? "online" : "offline";
		await Promise.all(
			[...(this.lifecycleListeners.get(event) ?? [])].map((listener) =>
				listener(),
			),
		);
	}
}

const goodNetworkStats = {
	rtt: 50,
	packetLoss: 0,
	availableOutgoingBitrate: 800_000,
	timestamp: 1_000_000,
	isValid: true,
};

function makeConsumer(
	environment: TestEnvironment,
	overrides: Partial<ConsumerEntry> & {
		bytes?: () => number;
		framesDecoded?: () => number;
	} = {},
): ConsumerEntry {
	const { bytes = () => 1000, framesDecoded = () => 10, ...entry } = overrides;
	return {
		id: "consumer-1",
		participantId: "participant-1",
		producerId: "producer-1",
		kind: "video",
		isScreen: false,
		adaptivelyPaused: false,
		track: { muted: false } as MediaStreamTrack,
		createdAt: environment.nowValue - 60_000,
		consumer: {
			paused: false,
			producerPaused: false,
			getStats: vi.fn().mockImplementation(
				async () =>
					new Map([
						[
							"inbound",
							{
								type: "inbound-rtp",
								kind: entry.kind ?? "video",
								bytesReceived: bytes(),
								framesDecoded: framesDecoded(),
							},
						],
					]),
			),
		} as unknown as ConsumerEntry["consumer"],
		...entry,
	};
}

function makeManager(
	options: {
		networkStats?: typeof goodNetworkStats;
		getNetworkStats?: () => Promise<typeof goodNetworkStats>;
		transportState?: string;
		consumers?: ConsumerEntry[];
		participant?: { audio_enabled?: boolean; video_enabled?: boolean };
	} = {},
) {
	const consumers = options.consumers ?? [];
	const getNetworkStats = vi
		.fn()
		.mockImplementation(
			options.getNetworkStats ??
				(async () => options.networkStats ?? goodNetworkStats),
		);
	const recoverConsumer = vi.fn().mockResolvedValue(undefined);
	const requestConsumerKeyFrame = vi.fn().mockResolvedValue(undefined);
	const resetReceiveMedia = vi.fn().mockResolvedValue(undefined);
	const reconcileExpectedMedia = vi.fn().mockResolvedValue(undefined);
	const recoverBrowserLifecycle = vi.fn().mockResolvedValue(undefined);
	const observeRemoteMediaProgress = vi.fn();
	const sendClientTelemetry = vi.fn();
	const manager: MediaHealthManager = {
		transportManager: {
			getTransportStats: () => ({
				sendTransport: { state: options.transportState ?? "connected" },
				recvTransport: { state: options.transportState ?? "connected" },
			}),
			getNetworkStats,
		},
		mediaManager: {
			consumerManager: {
				getAllConsumers: () => consumers,
				getConsumer: (id) => consumers.find((entry) => entry.id === id),
			},
			recoverConsumer,
		},
		participantManager: {
			getParticipant: () =>
				options.participant ?? { audio_enabled: true, video_enabled: true },
		},
		sfuClient: {
			requestConsumerKeyFrame,
			sendClientTelemetry,
		},
		resetReceiveMedia,
		reconcileExpectedMedia,
		recoverBrowserLifecycle,
		observeRemoteMediaProgress,
	};
	return {
		manager,
		getNetworkStats,
		recoverConsumer,
		requestConsumerKeyFrame,
		resetReceiveMedia,
		reconcileExpectedMedia,
		recoverBrowserLifecycle,
		observeRemoteMediaProgress,
		sendClientTelemetry,
	};
}

function startMonitor(manager: MediaHealthManager, environment: TestEnvironment) {
	const monitor = new MediaHealthMonitor(() => manager, environment);
	monitor.start();
	return monitor;
}

describe("MediaHealthMonitor", () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([
		[
			"good",
			{
				rtt: 520,
				packetLoss: 1,
				availableOutgoingBitrate: 900_000,
			},
		],
		[
			"poor",
			{
				rtt: 520,
				packetLoss: 1,
				availableOutgoingBitrate: 250_000,
			},
		],
		[
			"poor",
			{
				rtt: 150,
				packetLoss: 10,
				availableOutgoingBitrate: 900_000,
			},
		],
		[
			"critical",
			{
				rtt: 950,
				packetLoss: 3,
				availableOutgoingBitrate: 150_000,
			},
		],
	])("classifies %s network quality", async (quality, stats) => {
		const environment = new TestEnvironment();
		const { manager } = makeManager({
			networkStats: { ...goodNetworkStats, ...stats },
		});
		const monitor = startMonitor(manager, environment);

		await environment.advance(3000);

		expect(monitor.state.networkQuality).toBe(quality);
		expect(monitor.state.downlinkQuality).toBe("good");
	});

	it("treats only failed transports as hard failures", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const { manager, getNetworkStats } = makeManager({
			transportState: "failed",
			consumers: [consumer],
		});
		const monitor = startMonitor(manager, environment);

		await environment.advance(3000);

		expect(monitor.state).toMatchObject({
			networkQuality: "critical",
			isTransportFailed: true,
		});
		expect(getNetworkStats).not.toHaveBeenCalled();
		expect(consumer.consumer.getStats).not.toHaveBeenCalled();
	});

	it("does not recover media disabled by the remote participant", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment, { kind: "audio" });
		const { manager, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers: [consumer],
			participant: { audio_enabled: false },
		});
		startMonitor(manager, environment);

		await environment.advance(21_000);

		expect(recoverConsumer).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();
	});

	it("recreates only a consumer that misses its first RTP deadline", async () => {
		const environment = new TestEnvironment();
		const expected = makeConsumer(environment, {
			id: "expected",
			bytes: () => 0,
			framesDecoded: () => 0,
			createdAt: environment.nowValue - 20_000,
		});
		const adaptivelyPaused = makeConsumer(environment, {
			id: "paused",
			bytes: () => 0,
			framesDecoded: () => 0,
			adaptivelyPaused: true,
			createdAt: environment.nowValue - 20_000,
		});
		const {
			manager,
			recoverConsumer,
			requestConsumerKeyFrame,
			resetReceiveMedia,
		} = makeManager({ consumers: [expected, adaptivelyPaused] });
		startMonitor(manager, environment);

		await environment.advance(3000);

		expect(recoverConsumer).toHaveBeenCalledOnce();
		expect(recoverConsumer).toHaveBeenCalledWith(expected);
		expect(requestConsumerKeyFrame).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();
	});

	it("requests a keyframe before recreating a decode-stalled consumer", async () => {
		const environment = new TestEnvironment();
		let bytesReceived = 1000;
		const consumer = makeConsumer(environment, {
			id: "decode-stalled",
			bytes: () => (bytesReceived += 1000),
			framesDecoded: () => 10,
		});
		const {
			manager,
			recoverConsumer,
			requestConsumerKeyFrame,
			resetReceiveMedia,
			observeRemoteMediaProgress,
		} = makeManager({ consumers: [consumer] });
		startMonitor(manager, environment);

		await environment.advance(18_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
		expect(recoverConsumer).not.toHaveBeenCalled();
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			false,
		);

		await environment.advance(15_000);
		expect(recoverConsumer).toHaveBeenCalledOnce();
		expect(recoverConsumer).toHaveBeenCalledWith(consumer);
		expect(resetReceiveMedia).not.toHaveBeenCalled();
	});

	it("escalates an established video stall after consumer recovery attempts", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const { manager, requestConsumerKeyFrame, resetReceiveMedia } = makeManager({
			consumers: [consumer],
		});
		const monitor = startMonitor(manager, environment);

		await environment.advance(21_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
		expect(monitor.state.downlinkQuality).toBe("critical");

		await environment.advance(30_000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledTimes(2);
		expect(resetReceiveMedia).not.toHaveBeenCalled();

		await environment.advance(30_000);
		expect(resetReceiveMedia).toHaveBeenCalledOnce();
		expect(requestConsumerKeyFrame).toHaveBeenCalledTimes(2);
	});

	it("preserves network, first-media, and stall telemetry", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const {
			manager,
			sendClientTelemetry,
		} = makeManager({
			consumers: [consumer],
		});
		startMonitor(manager, environment);

		await environment.advance(21_000);

		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "network_quality",
			rttMs: 50,
			packetLossPercent: 0,
			availableOutgoingBitrate: 800_000,
		});
		expect(sendClientTelemetry).toHaveBeenCalledWith(
			expect.objectContaining({ event: "first_remote_media", media: "video" }),
		);
		expect(sendClientTelemetry).toHaveBeenCalledWith({
			event: "media_stall",
			media: "video",
		});
	});

	it("suppresses recovery on a poor network and recovers when quality clears", async () => {
		const environment = new TestEnvironment();
		const quality = { ...goodNetworkStats, rtt: 1300, packetLoss: 20 };
		const consumer = makeConsumer(environment);
		const { manager, requestConsumerKeyFrame, resetReceiveMedia } = makeManager({
			consumers: [consumer],
			getNetworkStats: async () => quality,
		});
		startMonitor(manager, environment);

		await environment.advance(30_000);
		expect(requestConsumerKeyFrame).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();

		quality.rtt = 50;
		quality.packetLoss = 0;
		await environment.advance(3000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
	});

	it("suspends polling while hidden or offline and recovers on resume", async () => {
		const environment = new TestEnvironment();
		const {
			manager,
			getNetworkStats,
			reconcileExpectedMedia,
			recoverBrowserLifecycle,
		} = makeManager();
		startMonitor(manager, environment);

		await environment.setHidden(true);
		await environment.advance(6000);
		expect(getNetworkStats).not.toHaveBeenCalled();
		expect(reconcileExpectedMedia).not.toHaveBeenCalled();

		await environment.setHidden(false);
		expect(recoverBrowserLifecycle).toHaveBeenCalledOnce();
		await environment.setOnline(false);
		await environment.advance(6000);
		expect(getNetworkStats).not.toHaveBeenCalled();

		await environment.setOnline(true);
		expect(recoverBrowserLifecycle).toHaveBeenCalledTimes(2);
		await environment.advance(3000);
		expect(getNetworkStats).toHaveBeenCalledOnce();
		expect(reconcileExpectedMedia).toHaveBeenCalledOnce();
	});

	it("ignores in-flight stats after lifecycle suspension", async () => {
		const environment = new TestEnvironment();
		let resolveStats: ((stats: typeof goodNetworkStats) => void) | undefined;
		const stats = new Promise<typeof goodNetworkStats>((resolve) => {
			resolveStats = resolve;
		});
		const { manager } = makeManager({ getNetworkStats: () => stats });
		const monitor = startMonitor(manager, environment);

		const polling = environment.advance(3000);
		await Promise.resolve();
		await environment.setHidden(true);
		resolveStats?.({ ...goodNetworkStats, packetLoss: 30 });
		await polling;

		expect(monitor.state.networkQuality).toBe("good");
	});

	it("uses fresh expected-media baselines after visibility resumes", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const { manager, observeRemoteMediaProgress } = makeManager({
			consumers: [consumer],
		});
		startMonitor(manager, environment);

		await environment.advance(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			true,
		);
		await environment.advance(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			false,
			false,
		);

		await environment.setHidden(true);
		await environment.setHidden(false);
		await environment.advance(3000);
		expect(observeRemoteMediaProgress).toHaveBeenLastCalledWith(
			"producer-1",
			"video",
			true,
			true,
		);
	});

	it("removes timers and lifecycle listeners when stopped", async () => {
		const environment = new TestEnvironment();
		const { manager, getNetworkStats, recoverBrowserLifecycle } = makeManager();
		const monitor = startMonitor(manager, environment);
		monitor.stop();

		await environment.advance(6000);
		await environment.setHidden(false);
		await environment.setOnline(true);

		expect(getNetworkStats).not.toHaveBeenCalled();
		expect(recoverBrowserLifecycle).not.toHaveBeenCalled();
	});
});
