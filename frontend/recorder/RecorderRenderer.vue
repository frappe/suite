<template>
	<main class="stage bg-surface-base text-ink-gray-9" aria-label="Recorded shared stage">
		<section class="media p-2.5 flex flex-col flex-1 min-h-0 text-white" aria-label="Participant media stage">
			<MeetingLayout
				:show-local-tile="false"
				:interactive="false"
			/>
		</section>
		<div class="rec"><span></span> REC {{ elapsed }}</div>
		<div v-if="interruption" class="interruption" role="status">Recording interrupted: {{ interruption }}</div>
		<aside v-if="messages.length" class="chat" aria-label="Public chat">
			<div
				v-for="message in messages"
				:key="message.id"
				class="chat-toast group flex w-[360px] max-w-full items-center rounded-md bg-surface-gray-9 px-4 py-2.5 shadow-xl after:bg-transparent"
			>
				<div class="flex w-full min-w-0 items-start gap-3 text-left">
					<MeetAvatar
						:image="message.avatar"
						:label="message.author"
						size="lg"
					/>
					<span class="min-w-0 flex-1">
						<strong class="block truncate text-p-base font-medium text-ink-base">{{ message.author }}</strong>
						<span class="block whitespace-pre-wrap break-words text-p-base text-ink-base">{{ message.text }}</span>
					</span>
				</div>
			</div>
		</aside>
	</main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref, type Ref } from "vue";
import MeetAvatar from "../src/apps/meet/components/MeetAvatar.vue";
import MeetingLayout from "../src/apps/meet/components/MeetingLayout.vue";
import { provideMeetingContext } from "../src/apps/meet/composables/useMeetingContext";
import type { VideoElementManager } from "../src/apps/meet/utils/media/VideoElementManager";

const props = withDefaults(defineProps<{
	startedAt: number;
	interruption?: string | null;
	messages?: Array<{ id: string; author: string; text: string; avatar?: string | null }>;
	meetingContext: Parameters<typeof provideMeetingContext>[0];
	videoManager: VideoElementManager;
	onPlaybackFailure?: (reason: string) => void;
	onScreenAttachment?: (consumerId: string, attachment: Promise<void>) => void;
}>(), { interruption: null, messages: () => [] });

const screenAttachments = new WeakMap<HTMLVideoElement, { stream: MediaStream; attachment: Promise<void> }>();

provideMeetingContext(props.meetingContext);
provide("sfuManager", ref(null));
provide("getParticipantName", props.meetingContext.participantStore.getParticipantName);
provide("setRemoteVideoRef", (participantId: string, element: HTMLVideoElement | null) => {
	if (element) props.videoManager.registerVideoElement(participantId, element);
	else props.videoManager.removeVideoElement(participantId);
});
provide("setScreenShareVideoRef", (consumerId: string, element: HTMLVideoElement | null) => {
	if (!element) return;
	const stream = props.meetingContext.mediaState.screenShareStreams[consumerId];
	if (stream) {
		element.muted = true;
		const existing = screenAttachments.get(element);
		const attachment = existing?.stream === stream
			? existing.attachment
			: attachScreenShare(element, stream, (error) => {
				props.onPlaybackFailure?.(`Screen playback failed: ${error instanceof Error ? error.message : "unknown error"}`);
			});
		screenAttachments.set(element, { stream, attachment });
		if (props.onScreenAttachment) props.onScreenAttachment(consumerId, attachment);
		else void attachment.catch(() => undefined);
	}
});

const attachmentRetryDelay = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
const attachScreenShare = async (element: HTMLVideoElement, stream: MediaStream, onFailure: (error: Error) => void): Promise<void> => {
	while (!element.parentNode) await attachmentRetryDelay();
	if (element.srcObject !== stream) element.srcObject = stream;
	while (true) {
		try {
			await element.play();
			return;
		} catch (error) {
			if (error instanceof DOMException && error.name === "AbortError") {
				await attachmentRetryDelay();
				continue;
			}
			const failure = error instanceof Error ? error : new Error("Screen playback failed");
			onFailure(failure);
			throw failure;
		}
	}
};

const now = ref(Date.now());
const timer = window.setInterval(() => now.value = Date.now(), 1000);
onBeforeUnmount(() => clearInterval(timer));
const elapsed = computed(() => {
	const seconds = Math.max(0, Math.floor((now.value - props.startedAt) / 1000));
	return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
});
</script>

<style scoped>
.stage{position:relative;display:flex;flex-direction:column;width:100vw;height:100vh;overflow:hidden;cursor:none;font:16px system-ui}.media{box-sizing:border-box}.rec{position:absolute;top:24px;right:28px;padding:8px 12px;border-radius:8px;background:#111c;font-variant-numeric:tabular-nums}.rec span{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ef4444}.interruption{position:absolute;top:24px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:8px;background:#991b1be8}.chat{position:absolute;right:28px;bottom:28px;display:grid;align-content:end;gap:8px;width:min(360px,calc(100vw - 56px));max-height:calc(100vh - 56px);overflow:hidden}
</style>
