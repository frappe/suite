<template>
	<Transition
		enter-active-class="transition-all duration-300 ease-out"
		enter-from-class="opacity-0 translate-y-2"
		enter-to-class="opacity-100 translate-y-0"
		leave-active-class="transition-all duration-200 ease-in"
		leave-from-class="opacity-100 translate-y-0"
		leave-to-class="opacity-0 translate-y-2"
	>
		<div
			v-show="isCaptionsEnabled && lines.length > 0"
			class="pointer-events-none z-[40] flex shrink-0 justify-center px-3 pb-2 pt-1 sm:px-6"
		>
			<div
				class="pointer-events-auto relative max-h-[min(20vh,12rem)] w-full max-w-[min(92vw,56rem)] overflow-hidden rounded-lg"
			>
				<div
					v-show="canScrollUp"
					class="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-black/90 via-black/55 to-transparent"
				/>
				<div
					ref="scrollContainer"
					class="caption-scrollbar-hidden flex max-h-[min(20vh,12rem)] flex-col items-start gap-1 overflow-y-auto overscroll-contain px-1 py-1"
					@scroll="updateScrollShadows"
				>
					<div
						v-for="line in visibleLines"
						:key="line.id"
						:class="[
							'flex max-w-full items-start gap-2 rounded-md px-3 py-1.5 text-left text-sm font-medium leading-snug text-white shadow-lg sm:text-base',
							{ 'opacity-60 italic': line.text === '...' },
						]"
						style="
							background-color: rgba(0, 0, 0, 0.65);
							text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
							overflow-wrap: anywhere;
						"
					>
						<Avatar
							size="sm"
							:image="line.avatar"
							:label="line.participantName"
							class="mt-0.5 shrink-0 ring-1 ring-white/20"
						/>
						<div class="min-w-0">
							<div class="text-xs font-semibold leading-tight text-white/75">
								{{ line.participantName }}
							</div>
							<div>{{ line.text }}</div>
						</div>
					</div>
				</div>
				<div
					v-show="canScrollDown"
					class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-black/90 via-black/55 to-transparent"
				/>
			</div>
		</div>
	</Transition>
</template>

<script setup>
import { Avatar } from "frappe-ui";
import { computed, nextTick, ref, watch } from "vue";

const props = defineProps({
	isCaptionsEnabled: Boolean,
	lines: {
		type: Array,
		default: () => [],
	},
	participants: {
		type: Object,
		default: () => ({}),
	},
	currentUser: {
		type: Object,
		default: null,
	},
});

const getParticipant = (participantId) => {
	if (props.currentUser?.user_id === participantId) {
		return {
			name: props.currentUser.full_name || props.currentUser.name || "You",
			avatar: props.currentUser.avatar || "",
		};
	}

	const participant = props.participants?.[participantId];
	return {
		name: participant?.user_name || participant?.full_name || participantId,
		avatar: participant?.avatar || "",
	};
};

const scrollContainer = ref(null);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const shouldStickToBottom = ref(true);

const visibleLines = computed(() =>
	props.lines.map((line) => {
		const participant = getParticipant(line.participantId);
		return {
			...line,
			participantName: participant.name || line.participantName,
			avatar: participant.avatar,
		};
	}),
);

const updateScrollShadows = () => {
	const el = scrollContainer.value;
	if (!el) return;
	canScrollUp.value = el.scrollTop > 1;
	canScrollDown.value = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
	shouldStickToBottom.value = !canScrollDown.value;
};

watch(
	() => props.lines.length,
	() => {
		const stickToBottom = shouldStickToBottom.value;
		nextTick(() => {
			const el = scrollContainer.value;
			if (el && stickToBottom) el.scrollTop = el.scrollHeight;
			updateScrollShadows();
		});
	},
);

watch(visibleLines, () => nextTick(updateScrollShadows), { immediate: true });
</script>

<style scoped>
.caption-scrollbar-hidden {
	scrollbar-width: none;
}

.caption-scrollbar-hidden::-webkit-scrollbar {
	display: none;
}
</style>
