import type { Consumer, Producer } from "mediasoup-client/types";
import type { SFUClient } from "../SFUClient";
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

type ConsumerParams = {
	id: string;
	producerId: string;
	kind: string;
	rtpParameters: unknown;
	isScreen?: boolean;
	appData?: {
		type?: string;
	};
	senderId?: number;
};

type RouterCapabilities = {
	codecs?: Array<{
		mimeType?: string;
		mime_type?: string;
		scalabilityModes?: string[];
	}>;
} | null;

type TransportLike = {
	id: string;
	connectionState: TransportConnectionState;
	on: <TArgs extends unknown[]>(
		event: string,
		handler: (...args: TArgs) => void,
	) => void;
	close: () => void;
	restartIce: (args: { iceParameters: unknown }) => Promise<void>;
	produce?: (options: Record<string, unknown>) => Promise<Producer>;
	consume?: (args: Record<string, unknown>) => Promise<Consumer>;
	getStats: () => Promise<Map<string, TransportStatReport>>;
};

type DeviceLike = {
	loaded: boolean;
	rtpCapabilities?: {
		codecs?: Array<{ mimeType: string }>;
	};
	load: (args: { routerRtpCapabilities: unknown }) => Promise<void>;
	canProduce: (kind: string) => boolean;
	createSendTransport: (args: Record<string, unknown>) => TransportLike;
	createRecvTransport: (args: Record<string, unknown>) => TransportLike;
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
	sendTransport: TransportLike | null;
	recvTransport: TransportLike | null;
	device: DeviceLike | null;
	sfuClient: SFUClient | null;
	routerRtpCapabilities: RouterCapabilities;
	activeVideoStrategy: string;
	eventHandlers: EventHandlers;
	e2eePolicy: E2EETransformPolicy;

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

	private extractRouterRtpCapabilities(response: unknown): RouterCapabilities {
		if (
			typeof response === "object" &&
			response !== null &&
			"rtpCapabilities" in response
		) {
			return (response as { rtpCapabilities: RouterCapabilities })
				.rtpCapabilities;
		}
		return response as RouterCapabilities;
	}

	async initializeDevice() {
		if (this.device) return this.device;
		const { Device } = await import("mediasoup-client");
		const client = this.getClient();
		this.device = new Device() as unknown as DeviceLike;
		const routerCapsResp = await client.getRouterRtpCapabilities();
		const routerRtpCapabilities =
			this.extractRouterRtpCapabilities(routerCapsResp);
		this.routerRtpCapabilities = routerRtpCapabilities;

		await this.device.load({ routerRtpCapabilities });

		return this.device;
	}

	async createSendTransport() {
		if (this.sendTransport) return this.sendTransport;
		this.e2eePolicy.assertContextReady("create send transport");
		if (!this.device) await this.initializeDevice();
		if (!this.device) throw new Error("Device failed to initialize");
		const client = this.getClient();
		const rawTransportParams = await client.createWebRtcTransport("send");
		const shouldEnableLegacyInsertableStreams =
			this.e2eePolicy.legacyInsertableStreamsEnabled;

		const additionalSettings: Record<string, unknown> = {};
		if (shouldEnableLegacyInsertableStreams) {
			additionalSettings.encodedInsertableStreams = true;
		}

		this.sendTransport = this.device.createSendTransport({
			id: rawTransportParams.id,
			iceParameters: rawTransportParams.iceParameters,
			iceCandidates: rawTransportParams.iceCandidates,
			dtlsParameters: rawTransportParams.dtlsParameters,
			additionalSettings,
		});
		this.setupSendTransportHandlers();

		return this.sendTransport;
	}

	setupSendTransportHandlers() {
		if (!this.sendTransport) return;
		const client = this.getClient();
		const sendTransport: TransportLike = this.sendTransport;
		const sendTransportId = sendTransport.id;
		sendTransport.on(
			"connect",
			async (
				{ dtlsParameters }: { dtlsParameters: unknown },
				callback: () => void,
				errback: (error: unknown) => void,
			) => {
				try {
					await client.connectWebRtcTransport(sendTransportId, dtlsParameters);
					callback();
				} catch (error) {
					errback(error);
				}
			},
		);

		sendTransport.on("produce", async (...args: unknown[]) => {
			const [parameters, callback, errback] = args as [
				{ rtpParameters: unknown; kind: string; appData: unknown },
				(result: { id: string }) => void,
				(error: unknown) => void,
			];
			if (!parameters || typeof callback !== "function") return;

			try {
				const response = (await client.createProducer(
					sendTransportId,
					parameters.rtpParameters,
					parameters.kind,
					parameters.appData,
				)) as { id: string };
				callback({ id: response.id });
			} catch (error) {
				errback(error);
			}
		});

		sendTransport.on("connectionstatechange", (state: unknown) => {
			if (state === "failed") {
				console.error("Send transport failed");
			}
			this.emitTransportConnectionState("send", String(state));
		});
	}

	async createReceiveTransport() {
		if (this.recvTransport) return this.recvTransport;
		this.e2eePolicy.assertContextReady("create receive transport");
		if (!this.device) await this.initializeDevice();
		if (!this.device) throw new Error("Device failed to initialize");
		const client = this.getClient();
		const rawTransportParams = await client.createWebRtcTransport("recv");
		const shouldEnableLegacyInsertableStreams =
			this.e2eePolicy.legacyInsertableStreamsEnabled;

		const additionalSettings: Record<string, unknown> = {};
		if (shouldEnableLegacyInsertableStreams) {
			additionalSettings.encodedInsertableStreams = true;
		}

		this.recvTransport = this.device.createRecvTransport({
			id: rawTransportParams.id,
			iceParameters: rawTransportParams.iceParameters,
			iceCandidates: rawTransportParams.iceCandidates,
			dtlsParameters: rawTransportParams.dtlsParameters,
			additionalSettings,
		});
		this.setupReceiveTransportHandlers();
		return this.recvTransport;
	}

	closeReceiveTransport() {
		if (!this.recvTransport) return;
		try {
			this.recvTransport.close();
		} catch (_e) {
			/* ignore */
		}
		this.recvTransport = null;
	}

	setupReceiveTransportHandlers() {
		if (!this.recvTransport) return;
		const client = this.getClient();
		const recvTransport: TransportLike = this.recvTransport;
		recvTransport.on(
			"connect",
			async (
				{ dtlsParameters }: { dtlsParameters: unknown },
				callback: () => void,
				errback: (error: unknown) => void,
			) => {
				try {
					await client.connectWebRtcTransport(recvTransport.id, dtlsParameters);
					callback();
				} catch (error) {
					errback(error);
				}
			},
		);

		recvTransport.on("connectionstatechange", (state: unknown) => {
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

	async restartAllTransportIce() {
		const results = await Promise.allSettled([
			this.restartTransportIce("send"),
			this.restartTransportIce("recv"),
		]);

		return results.some(
			(result) => result.status === "fulfilled" && result.value === true,
		);
	}

	async createProducer(
		track: MediaStreamTrack,
		appData: Record<string, unknown> = {},
	) {
		if (!this.sendTransport) await this.createSendTransport();
		if (!this.device?.canProduce?.(track?.kind || "video"))
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
		const produceOptions: Record<string, unknown> = {
			track,
			appData: {
				...safeAppData,
				e2eeStartPaused: e2eeWantedBeforeProduce,
			},
			stopTracks: false,
		};
		let senderTransformSetupStarted = false;
		const setupProducerSenderTransform = async (
			sender: RTCRtpSender | undefined,
		) => {
			if (!e2eeWantedBeforeProduce || !sender || senderTransformSetupStarted) {
				return false;
			}
			senderTransformSetupStarted = true;
			const senderId = this.e2eePolicy.ownSenderId;
			const mediaType = track?.kind ?? "video";
			return this.e2eePolicy
				.setupSenderTransform(sender, senderId, mediaType)
				.catch((error) => {
					console.warn("Failed to setup E2EE sender transform:", error);
					return false;
				});
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
		if (e2eeGate && producer.rtpSender) {
			await setupProducerSenderTransform(producer.rtpSender);
		}
		if (e2eeWantedBeforeProduce) {
			await this.sfuClient?.resumeProducer?.(producer.id);
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

	async createConsumer(
		producerId: string,
		metadata: Record<string, unknown> = {},
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
		)) as ConsumerParams;

		const isScreen = !!(
			metadata.isScreen ||
			rawConsumerParams.isScreen ||
			rawConsumerParams?.appData?.type === "screen"
		);
		const e2eeWanted = this.e2eePolicy.transformsEnabled;

		let consumer: Consumer | null = null;
		let firstError: unknown = null;
		try {
			const consumeArgs: Record<string, unknown> = {
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
				stats: Map<string, TransportStatReport>,
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
				(this.sendTransport.connectionState === "connected" ||
					this.sendTransport.connectionState === "completed")
			) {
				const sendStats = await this.sendTransport.getStats();
				processStats(sendStats, true);
			}

			if (
				this.recvTransport &&
				(this.recvTransport.connectionState === "connected" ||
					this.recvTransport.connectionState === "completed")
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
		if (this.sendTransport)
			try {
				this.sendTransport.close();
			} catch (_e) {
				/* ignore */
			}
		if (this.recvTransport)
			try {
				this.recvTransport.close();
			} catch (_e) {
				/* ignore */
			}
		this.sendTransport = null;
		this.recvTransport = null;
		this.device = null;
	}
}
