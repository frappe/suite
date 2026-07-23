<template>
	<section
		class="absolute right-2 top-2.5 z-[55] flex max-h-[calc(100%-1.25rem)] w-[calc(100%-1rem)] max-w-[380px] flex-col overflow-hidden rounded-[10px] border border-outline-gray-2 bg-surface-gray-1 text-ink-gray-8 shadow-xl"
		aria-label="Stats for nerds"
		data-testid="stats-for-nerds"
	>
		<header class="flex shrink-0 items-center justify-between gap-3 px-4 py-5">
			<div class="flex min-w-0 items-center gap-2.5">
				<span
					class="size-2.5 shrink-0 rounded-full"
					:class="qualityDot"
				/>
				<div class="min-w-0">
					<h2 class="truncate text-sm-medium tracking-[0.21px] text-ink-gray-8">Stats for nerds</h2>
					<p class="text-xs capitalize text-ink-gray-5">{{ snapshot.quality }} connection</p>
				</div>
			</div>
			<div class="flex items-center gap-1">
				<Tooltip text="Copy diagnostics">
					<button class="rounded-md p-1.5 text-ink-gray-5 hover:bg-surface-gray-2 hover:text-ink-gray-8" aria-label="Copy diagnostics" @click="copyDiagnostics">
						<LucideCopy class="size-4" />
					</button>
				</Tooltip>
				<Tooltip :text="expanded ? 'Show less' : 'Show more'">
					<button class="rounded-md p-1.5 text-ink-gray-5 hover:bg-surface-gray-2 hover:text-ink-gray-8" :aria-label="expanded ? 'Show less' : 'Show more'" @click="expanded = !expanded">
						<LucideChevronUp v-if="expanded" class="size-4" />
						<LucideChevronDown v-else class="size-4" />
					</button>
				</Tooltip>
				<Tooltip text="Close">
					<button class="rounded-md p-1.5 text-ink-gray-5 hover:bg-surface-gray-2 hover:text-ink-gray-8" aria-label="Close" @click="close">
						<LucideX class="size-4" />
					</button>
				</Tooltip>
			</div>
		</header>

		<div class="overflow-y-auto px-4 pb-4 text-xs">
			<div class="grid grid-cols-2 gap-x-5 gap-y-2">
				<StatValue label="Round-trip time" :value="formatMs(snapshot.rtt)" />
				<StatValue label="Jitter" :value="formatMs(snapshot.jitter)" />
				<StatValue label="Packet loss in" :value="formatPercent(snapshot.inboundPacketLoss)" />
				<StatValue label="Packet loss out" :value="formatPercent(snapshot.outboundPacketLoss)" />
				<StatValue label="Download" :value="formatBitrate(snapshot.downloadBitrate)" />
				<StatValue label="Upload" :value="formatBitrate(snapshot.uploadBitrate)" />
				<StatValue label="Available upload" :value="formatBitrate(snapshot.availableOutgoingBitrate)" />
				<StatValue label="Recovery" :value="humanize(connectionState.recoveryState)" />
			</div>

			<template v-if="expanded">
				<StatsSection title="Connection">
					<StatsRow label="Signaling" :value="connectionStatus" />
					<StatsRow label="Send transport" :value="transportStates.send" />
					<StatsRow label="Receive transport" :value="transportStates.receive" />
					<StatsRow label="ICE route" :value="iceRoute" />
					<StatsRow label="Protocol" :value="snapshot.protocol?.toUpperCase() || 'n/a'" />
					<StatsRow label="Encoding strategy" :value="connectionState.codecStrategy?.toUpperCase() || 'n/a'" />
					<StatsRow label="Encryption" :value="encryptionStatus" />
					<StatsRow label="Recoveries" :value="String(recoveryCount)" />
				</StatsSection>

				<StatsSection title="Sending" :badge="String(sendStreams.length)">
					<StreamStats v-for="stream in sendStreams" :key="stream.id" :stream="stream" />
					<p v-if="!sendStreams.length" class="py-2 text-ink-gray-5">No active outgoing streams</p>
				</StatsSection>

				<StatsSection title="Receiving" :badge="String(receiveStreams.length)">
					<StreamStats v-for="stream in receiveStreams" :key="stream.id" :stream="stream" />
					<p v-if="!receiveStreams.length" class="py-2 text-ink-gray-5">No active incoming streams</p>
				</StatsSection>

				<StatsSection v-if="connectionState.recoveryTimeline.length" title="Recovery history">
					<div v-for="entry in recentRecoveryTimeline" :key="`${entry.at}-${entry.state}`" class="border-b border-outline-gray-2 py-2 last:border-0">
						<div class="flex justify-between gap-3">
							<span class="capitalize text-ink-gray-7">{{ humanize(entry.state) }}</span>
							<time class="shrink-0 text-ink-gray-5">{{ formatTime(entry.at) }}</time>
						</div>
						<p v-if="entry.detail" class="mt-0.5 break-words text-ink-gray-5">{{ entry.detail }}</p>
					</div>
				</StatsSection>

				<p v-if="error" class="mt-3 rounded-md bg-surface-red-2 px-2.5 py-2 text-ink-red-4">{{ error }}</p>
			</template>
		</div>
	</section>
</template>

<script setup lang="ts">
import { Tooltip } from "frappe-ui";
import { computed, defineComponent, h, ref } from "vue";
import LucideChevronDown from "~icons/lucide/chevron-down";
import LucideChevronUp from "~icons/lucide/chevron-up";
import LucideCopy from "~icons/lucide/copy";
import LucideX from "~icons/lucide/x";
import { useConnectionState } from "../composables/useConnectionState";
import { useE2EEState } from "../composables/useE2EEState";
import { type RTCStreamStats, useRTCStats } from "../composables/useRTCStats";
import { setShowStatsForNerds } from "../data/statsPreferences";

const active = ref(true);
const expanded = ref(false);
const connectionState = useConnectionState();
const e2eeState = useE2EEState();
const { snapshot, sendStreams, receiveStreams, error } = useRTCStats(active);

const qualityDot = computed(() => ({
	"bg-green-400": snapshot.value.quality === "good",
	"bg-amber-400": snapshot.value.quality === "poor",
	"bg-red-400": snapshot.value.quality === "critical",
	"bg-gray-500": snapshot.value.quality === "unknown",
}));

const connectionStatus = computed(() => snapshot.value.signalingConnected ? "Connected" : "Disconnected");
const transportStates = computed(() => ({
	send: humanize(snapshot.value.sendTransportState),
	receive: humanize(snapshot.value.receiveTransportState),
}));
const iceRoute = computed(() => {
	const local = snapshot.value.localCandidateType;
	const remote = snapshot.value.remoteCandidateType;
	return local || remote ? `${local || "unknown"} → ${remote || "unknown"}` : "n/a";
});
const recoveryCount = computed(() => connectionState.recoveryTimeline.filter((entry) => entry.state !== "healthy").length);
const recentRecoveryTimeline = computed(() => connectionState.recoveryTimeline.slice(-8).reverse());
const encryptionStatus = computed(() => e2eeState.isContextReady.value ? "Active" : "Not active");

function close() {
	active.value = false;
	setShowStatsForNerds(false);
}

function formatBitrate(value?: number) {
	if (value === undefined || !Number.isFinite(value)) return "n/a";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} Mbps`;
	if (value >= 1_000) return `${Math.round(value / 1_000)} kbps`;
	return `${Math.round(value)} bps`;
}

function formatMs(value?: number) {
	return value === undefined || !Number.isFinite(value) ? "n/a" : `${Math.round(value)} ms`;
}

function formatPercent(value?: number) {
	return value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)}%`;
}

function humanize(value: string) {
	return value.replaceAll("_", " ");
}

function formatTime(value: string) {
	return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function copyDiagnostics() {
	await navigator.clipboard.writeText(JSON.stringify({
		capturedAt: new Date().toISOString(),
		stats: snapshot.value,
		recoveryState: connectionState.recoveryState,
		recoveryTimeline: connectionState.recoveryTimeline,
	}, null, 2));
}

const StatValue = defineComponent({
	props: { label: { type: String, required: true }, value: { type: String, required: true } },
	setup: (props) => () => h("div", [
		h("p", { class: "text-ink-gray-5" }, props.label),
		h("p", { class: "mt-0.5 truncate font-mono text-[13px] text-ink-gray-8" }, props.value),
	]),
});

const StatsRow = defineComponent({
	props: { label: { type: String, required: true }, value: { type: String, required: true } },
	setup: (props) => () => h("div", { class: "flex justify-between gap-4 py-1" }, [
		h("span", { class: "text-ink-gray-5" }, props.label),
		h("span", { class: "break-all text-right font-mono text-ink-gray-7" }, props.value),
	]),
});

const StatsSection = defineComponent({
	props: { title: { type: String, required: true }, badge: String },
	setup: (props, { slots }) => () => h("section", { class: "mt-5" }, [
		h("div", { class: "mb-1 flex items-center gap-2" }, [
			h("h3", { class: "font-semibold text-ink-gray-7" }, props.title),
			props.badge ? h("span", { class: "rounded bg-surface-gray-3 px-1.5 py-0.5 text-[10px] text-ink-gray-5" }, props.badge) : null,
		]),
		slots.default?.(),
	]),
});

const StreamStats = defineComponent({
	props: { stream: { type: Object as () => RTCStreamStats, required: true } },
	setup: (props) => () => {
		const stream = props.stream;
		const resolution = stream.width && stream.height ? `${Math.round(stream.width)}×${Math.round(stream.height)}` : "n/a";
		const status = stream.paused ? "paused" : stream.muted ? "muted" : "live";
		const rows = [
			["Status", status],
			["Codec", stream.codec || "n/a"],
			["Resolution / FPS", `${resolution} · ${stream.fps === undefined ? "n/a" : Math.round(stream.fps)} fps`],
			["Bitrate", formatBitrate(stream.bitrate)],
			["Packet loss / jitter", `${formatPercent(stream.packetLoss)} · ${formatMs(stream.jitter)}`],
			["RTT", formatMs(stream.rtt)],
			["Frames processed / dropped", `${stream.framesProcessed ?? "n/a"} / ${stream.framesDropped ?? "n/a"}`],
			["Quality limitation", stream.qualityLimitation || "n/a"],
			["Scalability mode", stream.scalabilityMode || "n/a"],
			["NACK / PLI / FIR", `${stream.nackCount ?? "n/a"} / ${stream.pliCount ?? "n/a"} / ${stream.firCount ?? "n/a"}`],
			["Jitter buffer", formatMs(stream.jitterBufferDelay)],
			["Audio concealed", stream.concealedSamples === undefined ? "n/a" : `${stream.concealedSamples} / ${stream.totalSamples ?? "n/a"} samples`],
		];
		return h("article", { class: "mt-2 rounded-lg bg-surface-gray-2 px-3 py-2 first:mt-1" }, [
			h("div", { class: "mb-1.5 flex items-center justify-between gap-3" }, [
				h("h4", { class: "capitalize text-ink-gray-7" }, stream.source),
				stream.participantId ? h("span", { class: "max-w-36 truncate font-mono text-[10px] text-ink-gray-5", title: stream.participantId }, stream.participantId) : null,
			]),
			...rows.map(([label, value]) => h(StatsRow, { label, value })),
		]);
	},
});
</script>
