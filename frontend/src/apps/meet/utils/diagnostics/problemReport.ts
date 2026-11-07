import type {
	AudioDiagnosticSample,
	ConnectionDiagnostics,
	RTCStatsReport,
} from "../SFUMeetingManager";
import type { RecoveryTimelineEntry } from "../../composables/useParticipantConnectionState";
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

type BuildProblemReportMailtoOptions = {
	meetingId: string;
	networkQuality?: string;
	localStream?: MediaStream | null;
	diagnostics?: ConnectionDiagnostics | null;
	consoleLogLimit?: number;
	recoveryTimeline?: RecoveryTimelineEntry[];
};

// Keep the complete encoded URI small, including the subject and escaping.
const MAX_MAILTO_CHARS = 2000;

type AudioStream = AudioDiagnosticSample["streams"][number];

function counterChange(
	before: AudioStream | undefined,
	after: AudioStream,
	field: keyof RTCStatsReport,
): string {
	if (!before) return "unavailable";
	const relevant = (report: RTCStatsReport) => {
		const type = after.direction === "send" ? "outbound-rtp" : "inbound-rtp";
		return (
			typeof report[field] === "number" &&
			(report.type === type ||
				(field === "totalAudioEnergy" &&
					(report.type === "media-source" || report.type === "track")))
		);
	};
	const current = after.reports.filter(relevant);
	const previous = before.reports.filter(relevant);
	if (!current.length || current.length !== previous.length)
		return "unavailable";
	let delta = 0;
	for (const report of current) {
		const old = previous.find((candidate) =>
			report.id
				? candidate.id === report.id
				: previous.length === 1 && candidate.type === report.type,
		);
		const value = report[field];
		const oldValue = old?.[field];
		if (
			typeof value !== "number" ||
			typeof oldValue !== "number" ||
			!Number.isFinite(value) ||
			!Number.isFinite(oldValue) ||
			value < oldValue
		) {
			return "unavailable";
		}
		delta += value - oldValue;
	}
	return Number.isInteger(delta) ? String(delta) : delta.toPrecision(3);
}

function audioSummary(samples: AudioDiagnosticSample[] = []): string[] {
	const first = samples[0];
	const latest = samples.at(-1);
	if (!latest) return ["Audio: statistics unavailable"];
	const elapsed =
		first && samples.length > 1
			? (Date.parse(latest.capturedAt) - Date.parse(first.capturedAt)) / 1000
			: NaN;
	const comparable =
		Number.isFinite(elapsed) && elapsed > 0 && !first?.error && !latest.error;
	const lines = [
		Number.isFinite(elapsed) && elapsed > 0
			? `Audio changes over ${elapsed.toFixed(1)}s:`
			: "Audio (changes unavailable):",
	];
	if (latest.error) lines.push("Audio statistics unavailable or timed out");
	if (!latest.streams.length && !latest.error)
		lines.push("No audio streams sampled");
	// Keep microphone evidence ahead of remote streams when the email must be shortened.
	const streams = [...latest.streams].sort(
		(a, b) => Number(b.direction === "send") - Number(a.direction === "send"),
	);
	const withSource = (
		stream: AudioStream,
		sample: AudioDiagnosticSample,
	): AudioStream => {
		const sourceIds = new Set(
			stream.reports.map((report) => report.mediaSourceId).filter(Boolean),
		);
		const existingIds = new Set(stream.reports.map((report) => report.id));
		return {
			...stream,
			reports: [
				...stream.reports,
				...(sample.transportReports ?? [])
					.flat()
					.filter(
						(report) =>
							report.id &&
							sourceIds.has(report.id) &&
							!existingIds.has(report.id),
					),
			],
		};
	};
	for (const stream of streams) {
		const previous = comparable
			? first?.streams.find(
					(entry) =>
						entry.id === stream.id && entry.direction === stream.direction,
				)
			: undefined;
		const change = (field: keyof RTCStatsReport) =>
			counterChange(
				previous && first ? withSource(previous, first) : undefined,
				withSource(stream, latest),
				field,
			);
		const name =
			stream.direction === "send"
				? "Mic"
				: `From ${stream.participantId || "unknown"}`;
		lines.push(
			`${name}: ${stream.trackEnabled === null || stream.trackEnabled === undefined ? "enabled unknown" : stream.trackEnabled ? "enabled" : "disabled"}, ${stream.trackState || "state unknown"}; paused=${stream.paused}; muted=${stream.muted}`,
		);
		lines.push(
			`  Packets ${stream.direction === "send" ? "sent" : "received"}: ${change(stream.direction === "send" ? "packetsSent" : "packetsReceived")}; bytes: ${change(stream.direction === "send" ? "bytesSent" : "bytesReceived")}; energy: ${change("totalAudioEnergy")}`,
		);
		if (stream.direction === "receive") {
			lines.push(
				`  Samples received: ${change("totalSamplesReceived")}; concealed: ${change("concealedSamples")}; lost packets: ${change("packetsLost")}`,
			);
			const playback = latest.playback.find(
				(entry) => entry.participantId === stream.participantId,
			);
			lines.push(
				playback
					? `  Playback: paused=${playback.paused}; muted=${playback.muted}; volume=${Math.round(playback.volume * 100)}%; ready=${playback.readyState}; error=${playback.error ?? "none"}`
					: "  Playback: no audio element",
			);
		}
	}
	return lines;
}

export async function buildProblemReportMailto(
	options: BuildProblemReportMailtoOptions,
): Promise<string> {
	const {
		meetingId,
		networkQuality,
		localStream = null,
		diagnostics = null,
		consoleLogLimit = 40,
		recoveryTimeline = [],
	} = options;

	const connectionStatus = diagnostics?.connectionStatus || {
		connected: false,
		socketId: null,
	};

	const transportStats: TransportStats = diagnostics?.transportStats || {
		sendTransport: { id: null, state: "closed" },
		recvTransport: { id: null, state: "closed" },
	};
	const networkStats: NetworkStats = diagnostics?.networkStats || null;
	const localAudioTrack = localStream?.getAudioTracks?.()?.[0];
	const localVideoTrack = localStream?.getVideoTracks?.()?.[0];
	const reportTime = new Date().toISOString();
	const siteDomain = window.location.hostname || "unknown-site";
	const subject = `[Meet] Issue report - ${Array.from(siteDomain).slice(0, 80).join("")}`;
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
		`- Meeting ID: ${meetingId}`,
		`- Timestamp: ${reportTime}`,
		...audioSummary(diagnostics?.audioSamples),
		"Silent media health:",
		...(diagnostics?.audioHealth?.paths ?? []).map(
			(path) =>
				`- ${path.id}: ${path.state}; attempts=${path.attempts}; media=${path.mediaId}`,
		),
		...(diagnostics?.audioHealth?.events ?? [])
			.slice(-10)
			.map((event) => `- ${event.id}: ${event.action} (${event.at})`),
		"",
		"Diagnostic snapshot:",
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
		`- Audio statistics samples: ${diagnostics?.audioSamples?.length ?? 0}`,
		`- Console logs captured: ${consoleSummary.total}`,
		`- Console errors/warnings: ${consoleSummary.error}/${consoleSummary.warn}`,
		"",
		recoveryHeader,
		...recoveryTimeline.map(
			(entry) =>
				`- ${entry.at}: ${entry.state}${entry.detail ? ` (${entry.detail})` : ""}`,
		),
		"",
		consoleHeader,
		...consoleLogLines,
		"",
	];

	const prefix = `mailto:?to=meet@frappe.io&subject=${encodeURIComponent(subject)}&body=`;
	const encode = (lines: string[]) =>
		prefix + encodeURIComponent(lines.join("\n"));
	// Logs and recovery history are last, so they are removed before audio evidence.
	const omitted = "[Report shortened to fit email link]";
	if (encode(bodyLines).length <= MAX_MAILTO_CHARS) return encode(bodyLines);
	while (
		bodyLines.length &&
		encode([...bodyLines, omitted]).length > MAX_MAILTO_CHARS
	) {
		bodyLines.pop();
	}
	return encode([...bodyLines, omitted]);
}

export async function openProblemReportEmail(
	options: BuildProblemReportMailtoOptions,
): Promise<void> {
	const mailto = await buildProblemReportMailto(options);
	window.location.href = mailto;
}
