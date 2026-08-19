import type { Socket } from 'socket.io';
import type {
	AppData,
	ProducerAppData,
	ProducerCloseDetails,
	ProducerCloseReason,
	ProducerCloseTrackSettings,
} from '../../types';
import { loggers } from '../../utils/logger';
import type { HandlerDeps } from './Handler';
import { getPeerId, getRoomId } from './utils';

export function registerProducerHandlers(deps: HandlerDeps) {
	return (socket: Socket) => {
		socket.on('create_producer', async (data, callback) => {
			const startedAt = performance.now();
			const media =
				data.kind === 'audio' || data.kind === 'video' ? data.kind : 'unknown';
			const appData = sanitizeProducerAppData(data.appData);
			const source = appData.type === 'screen' ? 'screen' : 'camera';
			let outcome: 'success' | 'failure' = 'failure';
			try {
				deps.authManager.ensureFullAccess(socket);
				enforceE2EEMediaPolicy(socket);
				const { transportId, rtpParameters, kind } = data;
				const startPaused = appData.e2eeStartPaused === true;
				const roomId = getRoomId(socket);
				const producer = await deps.mediasoup.createProducer(
					transportId,
					roomId,
					getPeerId(socket),
					rtpParameters,
					kind,
					appData,
					socket.senderId ?? 0,
					startPaused,
				);

				const isScreen =
					(producer.appData && producer.appData.type === 'screen') ||
					appData.type === 'screen';

				callback({ success: true, ...producer, isScreen });
				outcome = 'success';

				deps.registry.emitProducerCreated(roomId, {
					participantId: socket.userId,
					producerId: producer.id,
					kind: producer.kind,
					paused: startPaused,
					isScreen,
				});
			} catch (error) {
				loggers.socketHandler.error(
					'Error creating producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			} finally {
				deps.telemetry.recordMediaOperation(
					{
						operation: 'create_producer',
						direction: 'send',
						media,
						source,
						outcome,
					},
					(performance.now() - startedAt) / 1000,
				);
			}
		});

		socket.on('close_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				const reason = producerCloseReason(data.reason);
				const source = data.source === 'screen-share' ? data.source : undefined;
				const details = sanitizeProducerCloseDetails(data.details);
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					getPeerId(socket),
				);
				const result = deps.mediasoup.closeProducer(producerId, {
					reason,
					source,
					details,
				});

				loggers.socketHandler.info(
					'close_producer peer=%s producer=%s isScreen=%s reason=%s source=%s details=%o',
					socket.participantId || socket.userId,
					producerId,
					!!result.isScreen,
					reason || 'unspecified',
					source || 'unspecified',
					details || {},
				);

				callback({ success: true, ...result });
			} catch (error) {
				loggers.socketHandler.error(
					'Error closing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('pause_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					getPeerId(socket),
				);
				const paused = await deps.mediasoup.pauseProducer(producerId);

				callback({ success: true, paused });
			} catch (error) {
				loggers.socketHandler.error(
					'Error pausing producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});

		socket.on('resume_producer', async (data, callback) => {
			try {
				deps.authManager.ensureFullAccess(socket);
				const { producerId } = data;
				deps.mediasoup.assertProducerAccess(
					producerId,
					getRoomId(socket),
					getPeerId(socket),
				);
				const resumed = await deps.mediasoup.resumeProducer(producerId);

				callback({ success: true, resumed });
			} catch (error) {
				loggers.socketHandler.error(
					'Error resuming producer: %s',
					(error as Error).message,
				);
				callback({ success: false, error: (error as Error).message });
			}
		});
	};
}

function enforceE2EEMediaPolicy(socket: Socket): void {
	if (!socket.e2eeRequired) return;
	if (!socket.e2eeReady) {
		throw new Error('E2EE join handshake not completed');
	}
}

function sanitizeProducerAppData(value: AppData | undefined): ProducerAppData {
	const appData: ProducerAppData = {};
	if (value?.type === 'screen') appData.type = 'screen';
	if (typeof value?.e2eeStartPaused === 'boolean') {
		appData.e2eeStartPaused = value.e2eeStartPaused;
	}
	return appData;
}

function producerCloseReason(value: unknown): ProducerCloseReason | undefined {
	return value === 'user-click' ||
		value === 'track-ended' ||
		value === 'publish-failed' ||
		value === 'cleanup'
		? value
		: undefined;
}

function sanitizeProducerCloseDetails(
	value: unknown,
): ProducerCloseDetails | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;
	const details: ProducerCloseDetails = {};
	if ('trackId' in value && typeof value.trackId === 'string')
		details.trackId = value.trackId.slice(0, 256);
	if (
		'trackReadyState' in value &&
		(value.trackReadyState === 'live' || value.trackReadyState === 'ended')
	) {
		details.trackReadyState = value.trackReadyState;
	}
	if ('trackSettings' in value) {
		const trackSettings = sanitizeTrackSettings(value.trackSettings);
		if (trackSettings) details.trackSettings = trackSettings;
	}
	if ('message' in value && typeof value.message === 'string')
		details.message = value.message.slice(0, 256);
	return Object.keys(details).length ? details : undefined;
}

function sanitizeTrackSettings(
	value: unknown,
): ProducerCloseTrackSettings | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		return undefined;
	const settings: ProducerCloseTrackSettings = {};
	if ('aspectRatio' in value && typeof value.aspectRatio === 'number')
		settings.aspectRatio = value.aspectRatio;
	if ('autoGainControl' in value && typeof value.autoGainControl === 'boolean')
		settings.autoGainControl = value.autoGainControl;
	if ('channelCount' in value && typeof value.channelCount === 'number')
		settings.channelCount = value.channelCount;
	if ('deviceId' in value && typeof value.deviceId === 'string')
		settings.deviceId = value.deviceId.slice(0, 256);
	if ('displaySurface' in value && typeof value.displaySurface === 'string')
		settings.displaySurface = value.displaySurface.slice(0, 64);
	if (
		'echoCancellation' in value &&
		typeof value.echoCancellation === 'boolean'
	)
		settings.echoCancellation = value.echoCancellation;
	if ('facingMode' in value && typeof value.facingMode === 'string')
		settings.facingMode = value.facingMode.slice(0, 64);
	if ('frameRate' in value && typeof value.frameRate === 'number')
		settings.frameRate = value.frameRate;
	if ('groupId' in value && typeof value.groupId === 'string')
		settings.groupId = value.groupId.slice(0, 256);
	if ('height' in value && typeof value.height === 'number')
		settings.height = value.height;
	if ('latency' in value && typeof value.latency === 'number')
		settings.latency = value.latency;
	if ('logicalSurface' in value && typeof value.logicalSurface === 'boolean')
		settings.logicalSurface = value.logicalSurface;
	if (
		'noiseSuppression' in value &&
		typeof value.noiseSuppression === 'boolean'
	)
		settings.noiseSuppression = value.noiseSuppression;
	if (
		'restrictOwnAudio' in value &&
		typeof value.restrictOwnAudio === 'boolean'
	)
		settings.restrictOwnAudio = value.restrictOwnAudio;
	if ('sampleRate' in value && typeof value.sampleRate === 'number')
		settings.sampleRate = value.sampleRate;
	if ('sampleSize' in value && typeof value.sampleSize === 'number')
		settings.sampleSize = value.sampleSize;
	if ('screenPixelRatio' in value && typeof value.screenPixelRatio === 'number')
		settings.screenPixelRatio = value.screenPixelRatio;
	if (
		'suppressLocalAudioPlayback' in value &&
		typeof value.suppressLocalAudioPlayback === 'boolean'
	)
		settings.suppressLocalAudioPlayback = value.suppressLocalAudioPlayback;
	if ('width' in value && typeof value.width === 'number')
		settings.width = value.width;
	return Object.keys(settings).length ? settings : undefined;
}
