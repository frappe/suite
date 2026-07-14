import type { SFUClient } from "../SFUClient";
import type { RecoveryTimelineEntry } from "../../composables/useConnectionState";
import { getConsoleLogLines, getConsoleLogSummary } from "./consoleBuffer";

type TransportStats = {
	sendTransport: { id: string | null; state: string };
	recvTransport: { id: string | null; state: string };
};

type NetworkStats = {
	rtt?: number;
	packetLoss?: number;
	availableOutgoingBitrate?: number;
	isValid?: boolean;
} | null;

type TransportManagerLike = {
	getTransportStats?: () => TransportStats;
	getNetworkStats?: () => Promise<NetworkStats>;
};

type BuildProblemReportMailtoOptions = {
	meetingId: string;
	networkQuality?: string;
	localStream?: MediaStream | null;
	transportManager?: TransportManagerLike | null;
	sfuClient?: SFUClient | null;
	consoleLogLimit?: number;
	maxBodyChars?: number;
	recoveryTimeline?: RecoveryTimelineEntry[];
};

function getTransportStats(
	transportManager?: TransportManagerLike | null,
): TransportStats {
	return (
		transportManager?.getTransportStats?.() || {
			sendTransport: { id: null, state: "closed" },
			recvTransport: { id: null, state: "closed" },
		}
	);
}

async function getNetworkStats(
	transportManager?: TransportManagerLike | null,
): Promise<NetworkStats> {
	try {
		return (await transportManager?.getNetworkStats?.()) || null;
	} catch (_error) {
		return null;
	}
}

async function buildProblemReportMailto(
	options: BuildProblemReportMailtoOptions,
): Promise<string> {
	const {
		meetingId,
		networkQuality,
		localStream = null,
		transportManager = null,
		sfuClient = null,
		consoleLogLimit = 40,
		maxBodyChars = 7000,
		recoveryTimeline = [],
	} = options;

	const connectionStatus = sfuClient?.getConnectionStatus?.() || {
		connected: false,
		socketId: null,
	};

	const transportStats = getTransportStats(transportManager);
	const networkStats = await getNetworkStats(transportManager);
	const localAudioTrack = localStream?.getAudioTracks?.()?.[0];
	const localVideoTrack = localStream?.getVideoTracks?.()?.[0];
	const reportTime = new Date().toISOString();
	const siteDomain = window.location.hostname || "unknown-site";
	const subject = `[Meet] Issue report - ${siteDomain}`;
	const consoleLogLines = getConsoleLogLines(consoleLogLimit);
	const consoleSummary = getConsoleLogSummary();
	const consoleHeader = `Console logs (last ${consoleLogLines.length}):`;
	const recoveryHeader = `Recovery timeline (last ${recoveryTimeline.length}):`;

	const bodyLines = [
		"Hi,",
		"",
		"I am reporting an issue from Frappe Meet.",
		"",
		"Please describe what happened:",
		"- Expected:",
		"- Actual:",
		"- Steps to reproduce:",
		"",
		"Diagnostic snapshot:",
		`- Timestamp: ${reportTime}`,
		`- Meeting ID: ${meetingId}`,
		`- URL: ${window.location.href}`,
		`- User agent: ${navigator.userAgent}`,
		`- Online: ${navigator.onLine}`,
		`- Connection status: ${connectionStatus.connected ? "connected" : "disconnected"}`,
		`- Socket ID: ${connectionStatus.socketId || "n/a"}`,
		`- Send transport: ${transportStats.sendTransport.state} (${transportStats.sendTransport.id || "n/a"})`,
		`- Recv transport: ${transportStats.recvTransport.state} (${transportStats.recvTransport.id || "n/a"})`,
		`- Meeting network quality: ${networkQuality || "unknown"}`,
		`- Local audio track: ${localAudioTrack?.readyState || "none"}`,
		`- Local video track: ${localVideoTrack?.readyState || "none"}`,
		`- RTT (ms): ${
			networkStats?.isValid && Number.isFinite(networkStats?.rtt)
				? Math.round(networkStats.rtt ?? 0)
				: "n/a"
		}`,
		`- Packet loss (%): ${
			networkStats?.isValid && Number.isFinite(networkStats?.packetLoss)
				? Number(networkStats.packetLoss).toFixed(2)
				: "n/a"
		}`,
		`- Outgoing bitrate (bps): ${
			networkStats?.isValid &&
			Number.isFinite(networkStats?.availableOutgoingBitrate)
				? Math.round(networkStats.availableOutgoingBitrate ?? 0)
				: "n/a"
		}`,
		`- Console logs captured: ${consoleSummary.total}`,
		`- Console errors/warnings: ${consoleSummary.error}/${consoleSummary.warn}`,
		"",
		recoveryHeader,
		...recoveryTimeline.map(
			(entry) => `- ${entry.at}: ${entry.state}${entry.detail ? ` (${entry.detail})` : ""}`,
		),
		"",
		consoleHeader,
		...consoleLogLines,
		"",
		"If available, please attach the exported diagnostics file/log bundle.",
	];

	let bodyText = bodyLines.join("\n");
	if (bodyText.length > maxBodyChars && consoleLogLines.length > 10) {
		const trimmedLogs = consoleLogLines.slice(-10);
		const reducedBody = [
			...bodyLines.slice(0, bodyLines.indexOf(consoleHeader)),
			`Console logs (last ${trimmedLogs.length}, truncated):`,
			"",
			...trimmedLogs,
			"",
			"If available, please attach the exported diagnostics file/log bundle.",
		];
		bodyText = reducedBody.join("\n");
	}

	return `mailto:?to=meet@frappe.io&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
}

export async function openProblemReportEmail(
	options: BuildProblemReportMailtoOptions,
): Promise<void> {
	const mailto = await buildProblemReportMailto(options);
	window.location.href = mailto;
}
