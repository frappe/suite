import * as os from 'node:os';
import type {
	MediasoupConfig,
	WebRTCServerOptions,
	WebRTCTransportOptions,
	WorkerLogLevel,
	WorkerSettings,
} from '../types';
import { loggers } from '../utils/logger';

// Helper function to get server's local IP address
function getServerIP(): string {
	const interfaces = os.networkInterfaces();
	for (const name of Object.keys(interfaces)) {
		const interfaceInfo = interfaces[name];
		if (interfaceInfo) {
			for (const iface of interfaceInfo) {
				if (iface.family === 'IPv4' && !iface.internal) {
					loggers.config.info('Auto-detected server IP: %s', iface.address);
					return iface.address;
				}
			}
		}
	}
	loggers.config.warn(
		'Could not auto-detect server IP, using localhost. This will only work for local testing!',
	);
	return '127.0.0.1';
}

function hasWildcardListenIp(): boolean {
	return process.env.WEBRTC_LISTEN_IP?.trim() === '0.0.0.0';
}

function getAnnouncedAddress(listenIp: string): string {
	if (hasWildcardListenIp()) {
		loggers.config.warn(
			'Ignoring WEBRTC_ANNOUNCED_IP because WEBRTC_LISTEN_IP=0.0.0.0 was replaced with %s',
			listenIp,
		);
		return listenIp;
	}

	const announcedEnv = process.env.WEBRTC_ANNOUNCED_IP;
	if (announcedEnv) {
		const ips = Array.from(
			new Set(
				announcedEnv
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
			),
		);
		if (ips.length === 0) {
			loggers.config.warn(
				'WEBRTC_ANNOUNCED_IP provided but empty after parsing; falling back to auto-detect',
			);
		} else {
			if (ips.length > 1) {
				loggers.config.warn(
					'WEBRTC_ANNOUNCED_IP has multiple values; WebRtcServer uses the first one: %s',
					ips[0],
				);
			}
			return ips[0]!;
		}
	}

	return getServerIP();
}

function getListenIp(): string {
	const listenIp = process.env.WEBRTC_LISTEN_IP?.trim();
	if (listenIp && listenIp !== '0.0.0.0') return listenIp;
	if (hasWildcardListenIp()) {
		loggers.config.warn(
			'WEBRTC_LISTEN_IP=0.0.0.0 is not supported with WebRtcServer; auto-detecting a concrete interface IP',
		);
	}
	if (process.env.NODE_ENV === 'development') return '127.0.0.1';
	return getServerIP();
}

const listenIp = getListenIp();

const webRtcServerOptions: WebRTCServerOptions = {
	listenIp,
	announcedAddress: getAnnouncedAddress(listenIp),
	basePort: Number.parseInt(process.env.WEBRTC_SERVER_PORT || '40000', 10),
};

const mediaCodecs = [
	{
		kind: 'audio' as const,
		mimeType: 'audio/opus',
		clockRate: 48000,
		channels: 2,
	},
	{
		kind: 'video' as const,
		mimeType: 'video/VP8',
		clockRate: 90000,
		parameters: {
			'x-google-start-bitrate': 1000,
		},
	},
	{
		kind: 'video' as const,
		mimeType: 'video/VP9',
		clockRate: 90000,
		parameters: {
			'x-google-start-bitrate': 1000,
		},
	},
	{
		kind: 'video' as const,
		mimeType: 'video/h264',
		clockRate: 90000,
		parameters: {
			'packetization-mode': 1,
			'profile-level-id': '4d0032',
			'level-asymmetry-allowed': 1,
			'x-google-start-bitrate': 1000,
		},
	},
	{
		kind: 'video' as const,
		mimeType: 'video/h264',
		clockRate: 90000,
		parameters: {
			'packetization-mode': 1,
			'profile-level-id': '42e01f',
			'level-asymmetry-allowed': 1,
			'x-google-start-bitrate': 1000,
		},
	},
];

const webRtcTransportOptions: WebRTCTransportOptions = {
	enableUdp: true,
	enableTcp: false,
	preferUdp: true,
	// Add additional WebRTC options for better connectivity
	maxIncomingBitrate: 5000000,
	maxOutgoingBitrate: 5000000,
	initialAvailableOutgoingBitrate: 2500000,
	// Add ICE server configurations for NAT traversal
	iceServers: [
		{
			urls: ['stun:stun.l.google.com:19302'],
		},
		{
			urls: ['stun:global.stun.twilio.com:3478'],
		},
	],
	iceTransportPolicy: 'all',
};

const workerSettings: WorkerSettings = {
	logLevel: (process.env.MEDIASOUP_WORKER_LOGLEVEL as WorkerLogLevel) || 'warn',
	logTags: [
		'info',
		'ice',
		'dtls',
		'rtp',
		'srtp',
		'rtcp',
		'rtx',
		'bwe',
		'score',
		'simulcast',
		'svc',
		'sctp',
	],
	rtcMinPort: webRtcServerOptions.basePort,
	rtcMaxPort: webRtcServerOptions.basePort + 1000,
};

function resolveNumWorkers(): number {
	const envVal = Number.parseInt(process.env.MEDIASOUP_NUM_WORKERS || '', 10);
	if (!Number.isNaN(envVal) && envVal > 0) return envVal;
	const cpuCount = os.cpus()?.length || 2;
	return Math.max(1, cpuCount);
}

export const mediasoupConfig: MediasoupConfig = {
	numWorkers: resolveNumWorkers(),
	worker: workerSettings,
	router: { mediaCodecs },
	webRtcTransport: webRtcTransportOptions,
	webRtcServer: webRtcServerOptions,
};
