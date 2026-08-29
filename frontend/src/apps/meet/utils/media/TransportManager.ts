import type {
	AppData,
	Consumer,
	ConsumerOptions,
	Device,
	DtlsParameters,
	Producer,
	ProducerOptions,
	RtpCapabilities,
	Transport,
	TransportOptions,
} from "mediasoup-client/types";
import type { ProducerCloseMetadata, SFUClient } from "../SFUClient";
import { resolveCodecStrategy } from "./codecStrategy";
import {
	DefaultE2EETransformPolicy,
	type E2EETransformPolicy,
} from "./E2EETransformPolicy";
import {
	audioCodecOptions,
	screenEncodings,
	svcEncodingTemplate,
	videoCodecOptions,
	videoEncodings,
} from "./encodings";

type Direction = "send" | "recv";

export type IceRestartDirectionResult = "restarted" | "not-needed" | "failed";

export type TransportIceRestartResult = Record<
	Direction,
	IceRestartDirectionResult
>;

type TransportStatReport = {
	type?: string;
	state?: string;
	currentRoundTripTime?: number;
	availableOutgoingBitrate?: number;
	packetsReceived?: number;
	packetsLost?: number;
	roundTripTime?: number;
};

type TransportConnectionState =
	| "new"
	| "connecting"
	| "connected"
	| "failed"
	| "disconnected"
	| "closed"
	| string;

type TransportStateHandler = (payload: {
	direction: Direction;
	state: TransportConnectionState;
}) => void;

type EventHandlers = {
	onTransportConnectionStateChange?: TransportStateHandler;
};

type InsertableStreamRTCConfiguration = Partial<RTCConfiguration> & {
	encodedInsertableStreams?: boolean;
};

async function applyScreenShareSenderPreferences(producer: {
	rtpSender?: RTCRtpSender;
}) {
	const sender = producer.rtpSender;
	if (!sender?.getParameters || !sender?.setParameters) {
		return;
	}

	const parameters = sender.getParameters();
	if (parameters.degradationPreference === "maintain-resolution") {
		return;
	}

	parameters.degradationPreference = "maintain-resolution";
	await sender.setParameters(parameters);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TransportManager {
	sendTransport: Transport | null;
	recvTransport: Transport | null;
	device: Device | null;
	sfuClient: SFUClient | null;
	routerRtpCapabilities: RtpCapabilities | null;
	activeVideoStrategy: string;
	eventHandlers: EventHandlers;
	e2eePolicy: E2EETransformPolicy;
	private sendTransportCreation: Promise<Transport> | null = null;
	private recvTransportCreation: Promise<Transport> | null = null;
	private sendTransportGeneration = 0;
	private recvTransportGeneration = 0;
	private producerDiscards = new WeakMap<Producer, Promise<void>>();

	constructor(e2eePolicy?: E2EETransformPolicy) {
		this.sendTransport = null;
		this.recvTransport = null;
		this.device = null;
		this.sfuClient = null;
		this.routerRtpCapabilities = null;
		this.activeVideoStrategy = "svc";
		this.eventHandlers = {};
		this.e2eePolicy = e2eePolicy ?? new DefaultE2EETransformPolicy();
	}

	setEventHandlers(handlers: EventHandlers = {}) {
		this.eventHandlers = { ...this.eventHandlers, ...handlers };
	}

	emitTransportConnectionState(
		direction: Direction,
		state: TransportConnectionState,
	) {
		if (
			typeof this.eventHandlers.onTransportConnectionStateChange === "function"
		) {
			this.eventHandlers.onTransportConnectionStateChange({ direction, state });
		}
	}

	getVideoEncodingDecision() {
		const preference = this.sfuClient?.getCodecStrategy?.() || "svc";
		return resolveCodecStrategy({
			preference,
			deviceCapabilities: this.device?.rtpCapabilities,
			routerCapabilities: this.routerRtpCapabilities,
		});
	}

	getVideoEncodingConfig(source: "camera" | "screen" = "camera") {
		const decision = this.getVideoEncodingDecision();
		const isScreen = source === "screen";

		// no adaptive streaming for screensharing
		// as we don't reduce resolution for screenshare
		// and fps is handled by the hint in the browser in case of congestion control
		const strategy = isScreen ? "single" : decision.strategy;
		const scalabilityMode =
			strategy === "svc" ? decision.scalabilityMode : null;

		return {
			decision: {
				...decision,
				strategy,
				scalabilityMode,
			},
			encodings:
				strategy === "svc"
					? svcEncodingTemplate(scalabilityMode ?? undefined)
					: isScreen
						? screenEncodings
						: videoEncodings,
		};
	}

	initialize(sfuClient: SFUClient) {
		this.sfuClient = sfuClient;
		this.e2eePolicy.setSFUClient(sfuClient);
	}

	private getClient(): SFUClient {
		if (!this.sfuClient) throw new Error("SFU client is not initialized");
		return this.sfuClient;
	}

	async initializeDevice() {
		if (this.device) return this.device;
		const { Device } = await import("mediasoup-client");
		const client = this.getClient();
		this.device = new Device();
		const routerRtpCapabilities = await client.getRouterRtpCapabilities();
		this.routerRtpCapabilities = routerRtpCapabilities;

		await this.device.load({ routerRtpCapabilities });

		return this.device;
	}

	async createSendTransport() {
		if (this.sendTransport) return this.sendTransport;
		if (this.sendTransportCreation) return this.sendTransportCreation;

		const generation = this.sendTransportGeneration;
		const creation = (async () => {
			this.e2eePolicy.assertContextReady("create send transport");
			if (!this.device) await this.initializeDevice();
			const device = this.device;
			if (!device) throw new Error("Device failed to initialize");
			const client = this.getClient();
			const rawTransportParams = await client.createWebRtcTransport("send");
			const additionalSettings: InsertableStreamRTCConfiguration = {};
			if (this.e2eePolicy.legacyInsertableStreamsEnabled) {
				additionalSettings.encodedInsertableStreams = true;
			}

			const transport = device.createSendTransport({
				id: rawTransportParams.id,
				iceParameters: rawTransportParams.iceParameters,
				iceCandidates: rawTransportParams.iceCandidates,
				dtlsParameters: rawTransportParams.dtlsParameters,
				additionalSettings,
			});
			if (generation !== this.sendTransportGeneration) {
				transport.close();
				throw new Error("Send transport creation was cancelled");
			}
			this.sendTransport = transport;
			this.setupSendTransportHandlers();
			return transport;
		})();
		this.sendTransportCreation = creation;

		try {
			return await creation;
		} finally {
			if (this.sendTransportCreation === creation) {
				this.sendTransportCreation = null;
			}
		}
	}

	setupSendTransportHandlers() {
		if (!this.sendTransport) return;
		const client = this.getClient();
		const sendTransport = this.sendTransport;
		const sendTransportId = sendTransport.id;
		sendTransport.on(
			"connect",
			async (
				{ dtlsParameters }: { dtlsParameters: DtlsParameters },
				callback: () => void,
				errback: (error: Error) => void,
			) => {
				try {
					await client.connectWebRtcTransport(sendTransportId, dtlsParameters);
					callback();
				} catch (error) {
					errback(error instanceof Error ? error : new Error(String(error)));
				}
			},
		);

		sendTransport.on("produce", async (parameters, callback, errback) => {
			try {
				const response = await client.createProducer(
					sendTransportId,
					parameters.rtpParameters,
					parameters.kind,
					parameters.appData,
				);
				callback({ id: response.id });
			} catch (error) {
				errback(error instanceof Error ? error : new Error(String(error)));
			}
		});

		sendTransport.on("connectionstatechange", (state) => {
			if (state === "failed") {
				console.error("Send transport failed");
			}
			this.emitTransportConnectionState("send", String(state));
		});
	}

	async createReceiveTransport() {
		if (this.recvTransport) return this.recvTransport;
		if (this.recvTransportCreation) return this.recvTransportCreation;

		const generation = this.recvTransportGeneration;
		const creation = (async () => {
			this.e2eePolicy.assertContextReady("create receive transport");
			if (!this.device) await this.initializeDevice();
			const device = this.device;
			if (!device) throw new Error("Device failed to initialize");
			const client = this.getClient();
			const rawTransportParams = await client.createWebRtcTransport("recv");
			const additionalSettings: InsertableStreamRTCConfiguration = {};
			if (this.e2eePolicy.legacyInsertableStreamsEnabled) {
				additionalSettings.encodedInsertableStreams = true;
			}

			const transport = device.createRecvTransport({
				id: rawTransportParams.id,
				iceParameters: rawTransportParams.iceParameters,
				iceCandidates: rawTransportParams.iceCandidates,
				dtlsParameters: rawTransportParams.dtlsParameters,
				additionalSettings,
			});
			if (generation !== this.recvTransportGeneration) {
				transport.close();
				throw new Error("Receive transport creation was cancelled");
			}
			this.recvTransport = transport;
			this.setupReceiveTransportHandlers();
			return transport;
		})();
		this.recvTransportCreation = creation;

		try {
			return await creation;
		} finally {
			if (this.recvTransportCreation === creation) {
				this.recvTransportCreation = null;
			}
		}
	}

	closeReceiveTransport() {
		this.recvTransportGeneration++;
		this.recvTransportCreation = null;
		const transport = this.recvTransport;
		this.recvTransport = null;
		if (!transport) return;
		try {
			transport.close();
		} catch (_e) {
			/* ignore */
		}
	}

	closeSendTransport() {
		this.sendTransportGeneration++;
		this.sendTransportCreation = null;
		const transport = this.sendTransport;
		this.sendTransport = null;
		if (!transport) return;
		try {
			transport.close();
		} catch (_e) {
			/* ignore */
		}
	}

	setupReceiveTransportHandlers() {
		if (!this.recvTransport) return;
		const client = this.getClient();
		const recvTransport = this.recvTransport;
		recvTransport.on(
			"connect",
			async (
				{ dtlsParameters }: { dtlsParameters: DtlsParameters },
				callback: () => void,
				errback: (error: Error) => void,
			) => {
				try {
					await client.connectWebRtcTransport(recvTransport.id, dtlsParameters);
					callback();
				} catch (error) {
					errback(error instanceof Error ? error : new Error(String(error)));
				}
			},
		);

		recvTransport.on("connectionstatechange", (state) => {
			if (state === "failed") {
				console.error("Receive transport failed");
			}
			this.emitTransportConnectionState("recv", String(state));
		});
	}

	async restartTransportIce(direction: Direction) {
		const transport =
			direction === "send" ? this.sendTransport : this.recvTransport;
		if (!transport || !this.sfuClient) {
			return false;
		}

		const iceParameters = await this.sfuClient.restartWebRtcTransportIce(
			transport.id,
		);
		await transport.restartIce({ iceParameters });
		return true;
	}

	async restartAllTransportIce(): Promise<TransportIceRestartResult> {
		const restartDirection = async (
			direction: Direction,
		): Promise<IceRestartDirectionResult> => {
			const transport =
				direction === "send" ? this.sendTransport : this.recvTransport;
			if (!transport) return "not-needed";

			try {
				return (await this.restartTransportIce(direction))
					? "restarted"
					: "failed";
			} catch {
				return "failed";
			}
		};

		const [send, recv] = await Promise.all([
			restartDirection("send"),
			restartDirection("recv"),
		]);
		return { send, recv };
	}

	async createProducer(
		track: MediaStreamTrack,
		appData: AppData = {},
	) {
		if (!this.sendTransport) await this.createSendTransport();
		const kind = track.kind === "audio" ? "audio" : "video";
		if (!this.device?.canProduce(kind))
			throw new Error("Unsupported");
		if (!this.sendTransport?.produce)
			throw new Error("Send transport is not ready to produce");

		const safeAppData = { type: "camera", ...(appData || {}) };
		console.log("createProducer called", {
			trackId: track?.id,
			trackKind: track?.kind,
			trackReadyState: track?.readyState,
			appData: safeAppData,
		});

		const e2eeWantedBeforeProduce = this.e2eePolicy.transformsEnabled;
		const produceOptions: ProducerOptions = {
			track,
			appData: {
				...safeAppData,
				e2eeStartPaused: e2eeWantedBeforeProduce,
			},
			stopTracks: false,
		};
		let senderTransformSetup: Promise<boolean> | null = null;
		const setupProducerSenderTransform = async (
			sender: RTCRtpSender | undefined,
		) => {
			if (!e2eeWantedBeforeProduce || !sender) {
				return false;
			}
			senderTransformSetup ??= this.e2eePolicy.setupSenderTransform(
				sender,
				this.e2eePolicy.ownSenderId,
				track?.kind ?? "video",
			);
			return senderTransformSetup;
		};
		if (e2eeWantedBeforeProduce) {
			produceOptions.onRtpSender = setupProducerSenderTransform;
		}

		if (track?.kind === "video") {
			const source = safeAppData.type === "screen" ? "screen" : "camera";
			const encodingConfig = this.getVideoEncodingConfig(source);
			this.activeVideoStrategy = encodingConfig.decision.strategy;

			console.info("Video encoding decision", {
				strategy: encodingConfig.decision.strategy,
				scalabilityMode: encodingConfig.decision.scalabilityMode,
			});

			produceOptions.encodings = encodingConfig.encodings;
			if (encodingConfig.decision.strategy === "svc") {
				const vp9Codec = this.device?.rtpCapabilities?.codecs?.find((codec) =>
					codec.mimeType.toLowerCase().includes("vp9"),
				);
				if (vp9Codec) {
					produceOptions.codec = vp9Codec;
				}
			}
			if (safeAppData.type === "screen" && "contentHint" in track) {
				track.contentHint = "detail";
			}
			produceOptions.codecOptions = videoCodecOptions;
			produceOptions.appData = {
				...safeAppData,
				e2eeStartPaused: e2eeWantedBeforeProduce,
				codecStrategy: encodingConfig.decision.strategy,
				scalabilityMode: encodingConfig.decision.scalabilityMode,
			};
		}

		if (track?.kind === "audio") {
			produceOptions.codecOptions = audioCodecOptions;
		}

		const producer = await this.sendTransport.produce(produceOptions);
		const e2eeGate = this.e2eePolicy.transformsEnabled;
		const e2eeRequired = this.sfuClient?.isE2EERequired?.() ?? false;
		const hasContext = this.e2eePolicy.hasContext;
		console.log("[E2EE] createProducer gate", {
			e2eeGate,
			e2eeRequired,
			hasContext,
			hasRtpSender: !!producer.rtpSender,
			kind: track?.kind,
			senderId: this.e2eePolicy.ownSenderId,
		});
		if (e2eeWantedBeforeProduce) {
			try {
				const transformInstalled = senderTransformSetup
					? await senderTransformSetup
					: await setupProducerSenderTransform(producer.rtpSender);
				if (!transformInstalled) {
					throw new Error("Failed to install E2EE sender transform");
				}
				const { resumed } = await this.getClient().resumeProducer(producer.id);
				if (!resumed) {
					throw new Error("Failed to resume E2EE producer");
				}
			} catch (error) {
				await this.discardProducer(producer);
				throw error;
			}
		}

		if (safeAppData.type === "screen") {
			try {
				await applyScreenShareSenderPreferences(producer);
			} catch (error) {
				console.warn("Failed to apply screen share sender preferences", error);
			}
		}

		return producer;
	}

	discardProducer(
		producer: Producer,
		metadata: ProducerCloseMetadata = {},
	): Promise<void> {
		const existing = this.producerDiscards.get(producer);
		if (existing) return existing;

		try {
			producer.close();
		} catch {
			// The producer may already have closed with its transport.
		}
		const discard = producer.id && this.sfuClient
			? this.sfuClient
					.closeProducer(producer.id, metadata)
					.then(() => undefined)
					.catch(() => undefined)
			: Promise.resolve();
		this.producerDiscards.set(producer, discard);
		return discard;
	}

	async createConsumer(
		producerId: string,
		metadata: { isScreen?: boolean } = {},
	) {
		if (!this.device) await this.initializeDevice();
		if (!this.recvTransport) await this.createReceiveTransport();
		if (!this.device || !this.recvTransport)
			throw new Error("Consumer transport is not initialized");
		const client = this.getClient();
		const recvTransport = this.recvTransport;
		const device = this.device;
		if (!recvTransport.consume)
			throw new Error("Receive transport is not ready to consume");

		const rawConsumerParams = (await client.createConsumer(
			recvTransport.id,
			producerId,
			device.rtpCapabilities,
		));

		const isScreen = !!(
			metadata.isScreen ||
			rawConsumerParams.isScreen ||
			rawConsumerParams?.appData?.type === "screen"
		);
		const e2eeWanted = this.e2eePolicy.transformsEnabled;

		let consumer: Consumer | null = null;
		let firstError: unknown = null;
		try {
			const consumeArgs: ConsumerOptions = {
				id: rawConsumerParams.id,
				producerId: rawConsumerParams.producerId,
				kind: rawConsumerParams.kind,
				rtpParameters: rawConsumerParams.rtpParameters,
				...(isScreen ? { appData: { type: "screen" } } : {}),
			};
			if (e2eeWanted) {
				consumeArgs.onRtpReceiver = (receiver: RTCRtpReceiver) => {
					console.log("[E2EE] onRtpReceiver callback fired", {
						producerId: rawConsumerParams.producerId,
					});
					this.e2eePolicy.preCreateReceiverStreams(receiver);
				};
			}
			consumer = await recvTransport.consume(consumeArgs);
		} catch (err) {
			firstError = err;
			throw err;
		}

		if (!consumer && firstError) throw firstError;
		if (isScreen && consumer)
			console.info("Screen share consumer created", {
				consumerId: consumer.id,
			});

		if (consumer) {
			const e2eeRequired = this.sfuClient?.isE2EERequired?.() ?? false;
			const hasContext = this.e2eePolicy.hasContext;
			console.log("[E2EE] createConsumer gate", {
				e2eeGate: e2eeWanted,
				e2eeRequired,
				hasContext,
				hasRtpReceiver: !!consumer.rtpReceiver,
				producerId: rawConsumerParams.producerId,
				remoteSenderId: rawConsumerParams.senderId,
				mediaType: rawConsumerParams.kind,
			});
			if (e2eeWanted && consumer.rtpReceiver) {
				try {
					const remoteSenderId = rawConsumerParams.senderId ?? 0;
					const mediaType = rawConsumerParams.kind ?? "video";
					await this.e2eePolicy.setupReceiverTransform(
						consumer.rtpReceiver,
						remoteSenderId,
						mediaType,
					);
					if (mediaType === "video") {
						void this.requestConsumerKeyFrameBurst(
							consumer.id,
							rawConsumerParams.producerId,
						);
					}
				} catch (error) {
					console.warn("Failed to setup E2EE receiver transform:", error);
				}
			}
		}
		return consumer;
	}

	private async requestConsumerKeyFrameBurst(
		consumerId: string,
		producerId: string,
	): Promise<void> {
		const delays = [0, 120, 350, 800];
		for (const delay of delays) {
			if (delay > 0) {
				await sleep(delay);
			}
			try {
				const result =
					await this.sfuClient?.requestConsumerKeyFrame?.(consumerId);
				console.log("[E2EE] consumer keyframe requested", {
					producerId,
					consumerId,
					delay,
					result,
				});
			} catch (error) {
				console.warn("Failed to request E2EE consumer keyframe:", error);
			}
		}
	}

	getDeviceCapabilities() {
		return this.device?.rtpCapabilities || null;
	}

	isDeviceLoaded() {
		return this.device?.loaded || false;
	}

	getTransportStats() {
		return {
			sendTransport: {
				id: this.sendTransport?.id || null,
				state: this.sendTransport?.connectionState || "closed",
			},
			recvTransport: {
				id: this.recvTransport?.id || null,
				state: this.recvTransport?.connectionState || "closed",
			},
		};
	}

	async getNetworkStats() {
		const result = {
			rtt: 0,
			packetLoss: 0,
			availableOutgoingBitrate: 0,
			timestamp: Date.now(),
			isValid: false,
		};

		if (!this.sendTransport && !this.recvTransport) {
			return result;
		}

		try {
			let packetsSent = 0;
			let packetsLost = 0;
			let validStatsFound = false;

			// One RTT sample per transport, from a single report type.
			const transportRtt: number[] = [];

			const processStats = (
				stats: RTCStatsReport | Map<string, TransportStatReport>,
				preferRemoteInbound: boolean,
			) => {
				let remoteRttSum = 0;
				let remoteRttCount = 0;
				let pairRttSum = 0;
				let pairRttCount = 0;

				for (const report of stats.values()) {
					if (
						report.type === "candidate-pair" &&
						report.state === "succeeded"
					) {
						if (report.currentRoundTripTime !== undefined) {
							// Convert exact seconds to ms
							pairRttSum += report.currentRoundTripTime * 1000;
							pairRttCount++;
							if (report.availableOutgoingBitrate) {
								result.availableOutgoingBitrate =
									report.availableOutgoingBitrate;
							}
						}
					}

					if (report.type === "outbound-rtp") {
						validStatsFound = true;
					}

					// Inbound RTP (local receiving): downlink loss we see.
					if (report.type === "inbound-rtp") {
						validStatsFound = true;
						if (
							report.packetsReceived !== undefined &&
							report.packetsLost !== undefined
						) {
							packetsSent += report.packetsReceived + report.packetsLost;
							packetsLost += report.packetsLost;
						}
					}

					// Remote Inbound RTP: SFU's view of our outbound streams.
					// Per-stream RTT.
					if (
						report.type === "remote-inbound-rtp" &&
						report.roundTripTime !== undefined
					) {
						remoteRttSum += report.roundTripTime * 1000;
						remoteRttCount++;
					}
				}

				// Pick one source per transport. remote-inbound-rtp is
				// the per-stream RTT the SFU measured and is only
				// available on the send transport; recv falls back to
				// candidate-pair.
				if (preferRemoteInbound && remoteRttCount > 0) {
					transportRtt.push(remoteRttSum / remoteRttCount);
				} else if (pairRttCount > 0) {
					transportRtt.push(pairRttSum / pairRttCount);
				}
			};

			if (
				this.sendTransport &&
				this.sendTransport.connectionState === "connected"
			) {
				const sendStats = await this.sendTransport.getStats();
				processStats(sendStats, true);
			}

			if (
				this.recvTransport &&
				this.recvTransport.connectionState === "connected"
			) {
				const recvStats = await this.recvTransport.getStats();
				processStats(recvStats, false);
			}

			if (transportRtt.length > 0) {
				const total = transportRtt.reduce((sum, v) => sum + v, 0);
				result.rtt = total / transportRtt.length;
				validStatsFound = true;
			}

			if (packetsSent > 0) {
				result.packetLoss = (packetsLost / packetsSent) * 100;
			}

			result.isValid = validStatsFound;
			return result;
		} catch (error) {
			console.warn("Failed to get transport network stats", error);
			return result;
		}
	}

	cleanup() {
		this.closeSendTransport();
		this.closeReceiveTransport();
		this.device = null;
	}
}
