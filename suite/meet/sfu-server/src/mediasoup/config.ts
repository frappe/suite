import * as os from 'node:os';
import type {
	MediasoupConfig,
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

function buildListenIps(): Array<{ ip: string; announcedIp: string }> {
	const baseListenIp = process.env.WEBRTC_LISTEN_IP || '0.0.0.0';
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
			loggers.config.info(
				'Using announced IP list from env: %s',
				ips.join(', '),
			);
			return ips.map((ip) => ({ ip: baseListenIp, announcedIp: ip }));
		}
	}
	// Fallback single entry
	return [{ ip: baseListenIp, announcedIp: getServerIP() }];
}

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
	listenIps: buildListenIps(),
	enableUdp: true,
	enableTcp: true,
	preferUdp: true,
	portRange: {
		min: Number.parseInt(process.env.RTC_MIN_PORT || '40000', 10),
		max: Number.parseInt(process.env.RTC_MAX_PORT || '49999', 10),
	},
	// Add additional WebRTC options for better connectivity
	maxIncomingBitrate: 3000000,
	maxOutgoingBitrate: 3000000,
	initialAvailableOutgoingBitrate: 1000000,
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
	rtcMinPort: Number.parseInt(process.env.RTC_MIN_PORT || '40000', 10),
	rtcMaxPort: Number.parseInt(process.env.RTC_MAX_PORT || '49999', 10),
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
};
