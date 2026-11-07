import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsumerEntry } from "../ConsumerManager";
import {
	MediaHealthMonitor,
	type MediaHealthEnvironment,
	type MediaHealthPort,
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
	const reportNetworkQuality = vi.fn();
	const markFirstRemoteMedia = vi.fn();
	const reportMediaStalls = vi.fn();
	const port: MediaHealthPort = {
		getTransportStats: () => ({
			sendTransport: { state: options.transportState ?? "connected" },
			recvTransport: { state: options.transportState ?? "connected" },
		}),
		getNetworkStats,
		getConsumers: () => consumers,
		getConsumer: (id) => consumers.find((entry) => entry.id === id),
		isConsumerPaused: (entry) => {
			const participant = options.participant ?? {
				audio_enabled: true,
				video_enabled: true,
			};
			return Boolean(
				entry.consumer.paused ||
					(
						entry.consumer as typeof entry.consumer & {
							producerPaused?: boolean;
						}
					).producerPaused ||
					entry.adaptivelyPaused ||
					(entry.kind === "audio" && participant.audio_enabled === false) ||
					(entry.kind === "video" &&
						!entry.isScreen &&
						participant.video_enabled === false),
			);
		},
		recoverConsumer,
		requestConsumerKeyFrame,
		resetReceiveMedia,
		reconcileExpectedMedia,
		recoverBrowserLifecycle,
		observeRemoteMediaProgress,
		reportNetworkQuality,
		markFirstRemoteMedia,
		reportMediaStalls,
	};
	return {
		port,
		getNetworkStats,
		recoverConsumer,
		requestConsumerKeyFrame,
		resetReceiveMedia,
		reconcileExpectedMedia,
		recoverBrowserLifecycle,
		observeRemoteMediaProgress,
		reportNetworkQuality,
		markFirstRemoteMedia,
		reportMediaStalls,
	};
}

function startMonitor(port: MediaHealthPort, environment: TestEnvironment) {
	const monitor = new MediaHealthMonitor(port, environment);
	monitor.start();
	return monitor;
}

describe("MediaHealthMonitor", () => {
	it("recovers correlated audio and video loss within the old audio reset window", async () => {
		const environment = new TestEnvironment();
		let restored = false;
		const audio = makeConsumer(environment, {
			kind: "audio",
			bytes: () => (restored ? environment.nowValue : 1000),
		});
		const video = makeConsumer(environment, {
			id: "video",
			bytes: () => (restored ? environment.nowValue : 1000),
		});
		const { port, resetReceiveMedia } = makeManager({
			consumers: [audio, video],
		});
		port.isAudioProducerActive = () => true;
		resetReceiveMedia.mockImplementation(async () => {
			restored = true;
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(15_000);
		expect(restored).toBe(true);
		expect(resetReceiveMedia).toHaveBeenCalledTimes(1);
		monitor.stop();
	});

	it("rearms an exhausted sender after an explicit mic toggle or device change", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		let sourceId = "device-one";
		let intentionalPause = false;
		port.sampleAudioSender = async () => ({
			id: "mic",
			sourceId,
			intentionalPause,
			packets: 100,
			active: !intentionalPause,
		});
		const repairs: number[] = [];
		port.repairAudioSender = async (_id, attempt) => {
			repairs.push(attempt);
		};
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		intentionalPause = true;
		await environment.advance(3000);
		intentionalPause = false;
		await environment.advance(60_000);
		sourceId = "device-two";
		await environment.advance(60_000);
		expect(repairs).toEqual([1, 2, 3, 1, 2, 3, 1, 2, 3]);
		monitor.stop();
	});

	it("gives up on a permanent receive fault across consumer replacements", async () => {
		const environment = new TestEnvironment();
		const consumers = [
			makeConsumer(environment, { kind: "audio", bytes: () => 0 }),
		];
		const { port, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers,
		});
		port.isAudioProducerActive = () => true;
		recoverConsumer.mockImplementation(async () => {
			consumers[0] = makeConsumer(environment, {
				id: `replacement-${recoverConsumer.mock.calls.length}`,
				kind: "audio",
				bytes: () => 0,
			});
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(90_000);
		expect(recoverConsumer).toHaveBeenCalledTimes(3);
		expect(resetReceiveMedia).toHaveBeenCalledTimes(1);
		expect(monitor.audioHealth.paths).toContainEqual(
			expect.objectContaining({ state: "exhausted", attempts: 3 }),
		);
		monitor.stop();
	});

	it("does not reset shared media for consumers removed during stats sampling", async () => {
		const environment = new TestEnvironment();
		let removed = false;
		const audio = makeConsumer(environment, { kind: "audio" });
		const video = makeConsumer(environment, { id: "video" });
		const { port, resetReceiveMedia } = makeManager({
			consumers: [audio, video],
		});
		port.isAudioProducerActive = () => true;
		const lookup = port.getConsumer;
		port.getConsumer = (id) => (removed ? undefined : lookup(id));
		const monitor = startMonitor(port, environment);
		await environment.advance(9000);
		const stats = audio.consumer.getStats.bind(audio.consumer);
		audio.consumer.getStats = async () => {
			removed = true;
			return stats();
		};
		await environment.advance(3000);
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		monitor.stop();
	});

	it("rearms after a rejoin republishes the same retained microphone", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		let id = "before-rejoin";
		const repairs: number[] = [];
		port.sampleAudioSender = async () => ({
			id,
			sourceId: "retained-track",
			packets: 100,
			active: true,
		});
		port.repairAudioSender = async (_id, attempt) => {
			repairs.push(attempt);
		};
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		id = "after-rejoin";
		await environment.advance(60_000);
		expect(repairs).toEqual([1, 2, 3, 1, 2, 3]);
		monitor.stop();
	});

	it("keeps an exhausted warning when media evidence becomes unavailable", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		let missing = false;
		port.sampleAudioSender = async () => ({
			id: "mic",
			packets: missing ? null : 100,
			active: !missing,
		});
		port.repairAudioSender = async () => {};
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		missing = true;
		await environment.advance(3000);
		expect(monitor.state.status).toBe("degraded");
		expect(monitor.audioHealth.paths[0].state).toBe("exhausted");
		monitor.stop();
	});

	it("preserves the sender repair budget through hidden and resumed documents", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		const repairs: number[] = [];
		port.sampleAudioSender = async () => ({
			id: "mic",
			packets: 100,
			active: true,
		});
		port.repairAudioSender = async (_id, attempt) => {
			repairs.push(attempt);
		};
		const monitor = startMonitor(port, environment);
		await environment.advance(9000);
		await environment.setHidden(true);
		await environment.advance(30_000);
		await environment.setHidden(false);
		await environment.advance(60_000);
		expect(repairs).toEqual([1, 2, 3]);
		monitor.stop();
	});

	it("does not repair flat audio without fresh server activity", async () => {
		const environment = new TestEnvironment();
		const audio = makeConsumer(environment, { kind: "audio" });
		const { port, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers: [audio],
		});
		port.isAudioProducerActive = () => false;
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		expect(recoverConsumer).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		monitor.stop();
	});

	it("ignores an audio sample spanning a receive SDP epoch", async () => {
		const environment = new TestEnvironment();
		let epoch = 1;
		let settled = true;
		const audio = makeConsumer(environment, { kind: "audio" });
		audio.consumer.getStats = async () => {
			epoch++;
			return new Map([
				[
					"inbound",
					{ type: "inbound-rtp", kind: "audio", bytesReceived: 1000 },
				],
			]);
		};
		const { port, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers: [audio],
		});
		port.getReceiveEpoch = () => ({ epoch, settled });
		port.isAudioProducerActive = () => true;
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		settled = false;
		await environment.advance(30_000);
		expect(recoverConsumer).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		monitor.stop();
	});

	it("repairs only flat audio with fresh SFU speaker evidence", async () => {
		const environment = new TestEnvironment();
		const audio = makeConsumer(environment, { kind: "audio" });
		audio.consumer.getStats = async () =>
			new Map([
				[
					"inbound",
					{ type: "inbound-rtp", kind: "audio", bytesReceived: 1000 },
				],
			]);
		const video = makeConsumer(environment, {
			id: "healthy-video",
			bytes: () => environment.nowValue,
		});
		const { port, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers: [audio, video],
		});
		port.isAudioProducerActive = (entry) => entry === audio;
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		expect(recoverConsumer).toHaveBeenCalledWith(audio);
		expect(recoverConsumer.mock.calls.every(([entry]) => entry === audio)).toBe(
			true,
		);
		expect(resetReceiveMedia).not.toHaveBeenCalled();
		monitor.stop();
	});

	it("bounds active sender repair to reattach, send ICE, republish then gives up", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		const repairs: number[] = [];
		port.sampleAudioSender = async () => ({
			id: "mic",
			packets: 100,
			active: true,
		});
		port.repairAudioSender = async (_id, attempt) => {
			repairs.push(attempt);
		};
		const monitor = startMonitor(port, environment);
		await environment.advance(60_000);
		expect(repairs).toEqual([1, 2, 3]);
		expect(monitor.audioHealth.paths).toContainEqual(
			expect.objectContaining({
				id: "send:microphone",
				state: "exhausted",
				attempts: 3,
			}),
		);
		monitor.stop();
	});

	afterEach(() => vi.restoreAllMocks());

	it.each([
		[
			"good",
			{
				rtt: 50,
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
				rtt: 1300,
				packetLoss: 3,
				availableOutgoingBitrate: 150_000,
			},
		],
	])("classifies %s network quality", async (quality, stats) => {
		const environment = new TestEnvironment();
		const { port } = makeManager({
			networkStats: { ...goodNetworkStats, ...stats },
		});
		const monitor = startMonitor(port, environment);

		await environment.advance(3000);

		expect(monitor.state.networkQuality).toBe(quality);
		expect(monitor.state.downlinkQuality).toBe("unknown");
	});

	it("does not call missing stats a good connection", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager({
			networkStats: { ...goodNetworkStats, isValid: false },
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		expect(monitor.state.networkQuality).toBe("unknown");
		expect(monitor.state.status).toBe("checking");
	});

	it("warns about frozen receiving video while upload stats stay healthy", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager({ consumers: [makeConsumer(environment)] });
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		expect(monitor.state.downlinkQuality).toBe("critical");
		expect(monitor.state.status).toBe("degraded");
		expect(monitor.state.issue).toBe("receive");
	});

	it("does not clear a receiving warning on one good sample", async () => {
		const environment = new TestEnvironment();
		let frame = 10,
			bytes = 1000;
		const { port } = makeManager({
			consumers: [
				makeConsumer(environment, {
					bytes: () => bytes,
					framesDecoded: () => frame,
				}),
			],
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		expect(monitor.state.downlinkQuality).toBe("critical");
		bytes += 1000;
		frame += 75;
		await environment.advance(3000);
		expect(monitor.state.downlinkQuality).toBe("critical");
		for (let i = 0; i < 2; i++) {
			bytes += 1000;
			frame += 75;
			await environment.advance(3000);
		}
		expect(monitor.state.downlinkQuality).toBe("good");
	});

	it("keeps a receiving warning through unavailable samples and restarts healthy confirmation", async () => {
		const environment = new TestEnvironment();
		let bytes = 1000,
			frames = 10;
		const consumer = makeConsumer(environment, {
			bytes: () => bytes,
			framesDecoded: () => frames,
		});
		const { port } = makeManager({ consumers: [consumer] });
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		vi.mocked(consumer.consumer.getStats).mockRejectedValueOnce(
			new Error("replacing"),
		);
		await environment.advance(3000);
		expect(monitor.state.downlinkQuality).toBe("critical");
		for (let i = 0; i < 2; i++) {
			bytes += 1000;
			frames += 75;
			await environment.advance(3000);
		}
		expect(monitor.state.downlinkQuality).toBe("critical");
		bytes += 1000;
		frames += 75;
		await environment.advance(3000);
		expect(monitor.state.downlinkQuality).toBe("good");
	});

	it("warns for continuously bad upload even when severity alternates", async () => {
		const environment = new TestEnvironment();
		const stats = { ...goodNetworkStats };
		const { port } = makeManager({ getNetworkStats: async () => stats });
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		for (const loss of [10, 25, 10, 25]) {
			stats.packetLoss = loss;
			await environment.advance(3000);
		}
		expect(["poor", "critical"]).toContain(monitor.state.networkQuality);
	});

	it("does not blame the local downlink for a healthy four-fps source", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager({
			consumers: [
				makeConsumer(environment, {
					bytes: () => environment.now() * 10,
					framesDecoded: () => (environment.now() * 4) / 1000,
				}),
			],
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(15_000);
		expect(monitor.state.downlinkQuality).toBe("good");
	});

	it("keeps existing loss warnings while a new subscription is pending", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager({
			getNetworkStats: async () => ({
				...goodNetworkStats,
				downlink: { rtt: 50, jitter: 0, packetLoss: 25, isValid: true },
			}),
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		port.hasMissingExpectedReceiveMedia = () => true;
		await environment.advance(3000);
		expect(monitor.state.downlinkQuality).toBe("critical");
	});

	it.each([
		"new",
		"closed",
	])("does not verify %s send transport while enabled publication is missing", async (transportState) => {
		const environment = new TestEnvironment();
		const { port } = makeManager({ transportState });
		port.hasExpectedSendMedia = () => true;
		port.onRecoveryVerified = vi.fn();
		const monitor = startMonitor(port, environment);
		monitor.beginRecovery("send", "send rebuild");
		await environment.advance(15_000);
		expect(port.onRecoveryVerified).not.toHaveBeenCalled();
	});

	it.each([
		"incomplete",
		"unavailable",
	])("does not verify an %s static screen", async (condition) => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment, {
			isScreen: true,
			framesDecoded: () => (condition === "incomplete" ? 0 : 10),
		});
		const { port } = makeManager({ consumers: [consumer] });
		port.onRecoveryVerified = vi.fn();
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		monitor.beginRecovery("recv", "recv rebuild");
		if (condition === "unavailable")
			vi.mocked(consumer.consumer.getStats).mockRejectedValue(
				new Error("no sample"),
			);
		await environment.advance(12_000);
		expect(port.onRecoveryVerified).not.toHaveBeenCalled();
	});

	it("marks offline immediately, without waiting for WebRTC stats", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		const monitor = startMonitor(port, environment);
		await environment.setOnline(false);
		expect(monitor.state.status).toBe("disconnected");
	});

	it("keeps recovery pending while media is frozen, then verifies sustained delivery", async () => {
		const environment = new TestEnvironment();
		let frame = 10,
			bytes = 1000;
		const onRecoveryVerified = vi.fn();
		const { port } = makeManager({
			consumers: [
				makeConsumer(environment, {
					bytes: () => bytes,
					framesDecoded: () => frame,
				}),
			],
		});
		port.onRecoveryVerified = onRecoveryVerified;
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		monitor.beginRecovery("recv", "transport_recv_failed");
		await environment.advance(12_000);
		expect(monitor.state.status).toBe("reconnecting");
		expect(onRecoveryVerified).not.toHaveBeenCalled();
		for (let i = 0; i < 5; i++) {
			bytes += 1000;
			frame += 75;
			await environment.advance(3000);
		}
		expect(onRecoveryVerified).toHaveBeenCalledExactlyOnceWith(
			"transport_recv_failed",
		);
		expect(monitor.state.status).toBe("good");
	});

	it("expires previously good health if a stats call stops completing", async () => {
		const environment = new TestEnvironment();
		let release!: (value: typeof goodNetworkStats) => void;
		const { port, getNetworkStats } = makeManager();
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		getNetworkStats.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const pending = environment.advance(3000);
		await Promise.resolve();
		await environment.advance(12_000);
		expect(monitor.state.status).toBe("checking");
		expect(monitor.state.networkQuality).toBe("unknown");
		monitor.stop();
		release(goodNetworkStats);
		await pending;
	});

	it("warns when expected subscriptions are missing rather than treating an empty consumer list as healthy", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		port.hasMissingExpectedReceiveMedia = () => true;
		const monitor = startMonitor(port, environment);
		await environment.advance(12_000);
		expect(monitor.state.status).toBe("degraded");
		expect(monitor.state.issue).toBe("receive");
	});

	it("does not flicker for one bad network sample", async () => {
		const environment = new TestEnvironment();
		const stats = { ...goodNetworkStats };
		const { port } = makeManager({ getNetworkStats: async () => stats });
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		stats.packetLoss = 12;
		await environment.advance(3000);
		expect(monitor.state.networkQuality).toBe("good");
		stats.packetLoss = 0;
		await environment.advance(3000);
		expect(monitor.state.networkQuality).toBe("good");
	});

	it.each([
		["send", 25, 0],
		["receive", 0, 25],
	] as const)("attributes %s loss to the correct direction", async (direction, sendLoss, receiveLoss) => {
		const environment = new TestEnvironment();
		const { port } = makeManager({
			getNetworkStats: async () => ({
				...goodNetworkStats,
				timestamp: environment.now(),
				uplink: { rtt: 50, packetLoss: sendLoss, jitter: 0, isValid: true },
				downlink: {
					rtt: 50,
					packetLoss: receiveLoss,
					jitter: 0,
					isValid: true,
				},
			}),
		});
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		expect(monitor.state.issue).toBe(direction);
	});

	it("shows reconnecting when signaling is unavailable even if media transports stay connected", async () => {
		const environment = new TestEnvironment();
		const { port } = makeManager();
		port.isSignalingConnected = () => false;
		const monitor = startMonitor(port, environment);
		await environment.advance(3000);
		expect(monitor.state.status).toBe("reconnecting");
	});

	it("treats only failed transports as hard failures", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const { port, getNetworkStats } = makeManager({
			transportState: "failed",
			consumers: [consumer],
		});
		const monitor = startMonitor(port, environment);

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
		const { port, recoverConsumer, resetReceiveMedia } = makeManager({
			consumers: [consumer],
			participant: { audio_enabled: false },
		});
		startMonitor(port, environment);

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
			port,
			recoverConsumer,
			requestConsumerKeyFrame,
			resetReceiveMedia,
		} = makeManager({ consumers: [expected, adaptivelyPaused] });
		startMonitor(port, environment);

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
			port,
			recoverConsumer,
			requestConsumerKeyFrame,
			resetReceiveMedia,
			observeRemoteMediaProgress,
		} = makeManager({ consumers: [consumer] });
		startMonitor(port, environment);

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
		const { port, requestConsumerKeyFrame, resetReceiveMedia } = makeManager({
			consumers: [consumer],
		});
		const monitor = startMonitor(port, environment);

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
			port,
			reportNetworkQuality,
			markFirstRemoteMedia,
			reportMediaStalls,
		} = makeManager({
			consumers: [consumer],
		});
		startMonitor(port, environment);

		await environment.advance(21_000);

		expect(reportNetworkQuality).toHaveBeenCalledWith(goodNetworkStats);
		expect(markFirstRemoteMedia).toHaveBeenCalledWith("video");
		expect(reportMediaStalls).toHaveBeenCalledWith(["video"]);
	});

	it("suppresses recovery on a poor network and recovers when quality clears", async () => {
		const environment = new TestEnvironment();
		const quality = { ...goodNetworkStats, rtt: 1300, packetLoss: 20 };
		const consumer = makeConsumer(environment);
		const { port, requestConsumerKeyFrame, resetReceiveMedia } = makeManager({
			consumers: [consumer],
			getNetworkStats: async () => quality,
		});
		startMonitor(port, environment);

		await environment.advance(30_000);
		expect(requestConsumerKeyFrame).not.toHaveBeenCalled();
		expect(resetReceiveMedia).not.toHaveBeenCalled();

		quality.rtt = 50;
		quality.packetLoss = 0;
		await environment.advance(9000);
		expect(requestConsumerKeyFrame).toHaveBeenCalledOnce();
	});

	it("suspends polling while hidden or offline and recovers on resume", async () => {
		const environment = new TestEnvironment();
		const {
			port,
			getNetworkStats,
			reconcileExpectedMedia,
			recoverBrowserLifecycle,
		} = makeManager();
		startMonitor(port, environment);

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
		const { port } = makeManager({ getNetworkStats: () => stats });
		const monitor = startMonitor(port, environment);

		const polling = environment.advance(3000);
		await Promise.resolve();
		await environment.setHidden(true);
		resolveStats?.({ ...goodNetworkStats, packetLoss: 30 });
		await polling;

		expect(monitor.state.networkQuality).toBe("unknown");
	});

	it("uses fresh expected-media baselines after visibility resumes", async () => {
		const environment = new TestEnvironment();
		const consumer = makeConsumer(environment);
		const { port, observeRemoteMediaProgress } = makeManager({
			consumers: [consumer],
		});
		startMonitor(port, environment);

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
		const { port, getNetworkStats, recoverBrowserLifecycle } = makeManager();
		const monitor = startMonitor(port, environment);
		monitor.stop();

		await environment.advance(6000);
		await environment.setHidden(false);
		await environment.setOnline(true);

		expect(getNetworkStats).not.toHaveBeenCalled();
		expect(recoverBrowserLifecycle).not.toHaveBeenCalled();
	});
});
