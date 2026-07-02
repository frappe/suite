<template>
	<div
		class="pointer-events-none w-full overflow-hidden shrink-0 transition-[height,margin] duration-500 ease-in-out"
		:class="{ 'mt-2 mb-2': isVisible }"
		:style="{ height: toolbarHeight }"
	>
		<div
			class="flex justify-center px-4 transition-transform duration-500 ease-in-out"
			:class="isVisible ? 'translate-y-0' : 'translate-y-full'"
		>
			<div
				class="flex items-center gap-3 p-4 bg-black/80 backdrop-blur-md rounded-full border border-white/10 shadow-xl pointer-events-auto transition-all duration-500"
				@mouseenter="onMouseEnter"
				@mouseleave="onMouseLeave"
				data-testid="meeting-toolbar"
			>
				<!-- Microphone -->
				<Button
					@click="$emit('toggle-microphone')"
					variant="solid"
					size="lg"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': !isMicOn,
					}"
					:title="`Toggle Audio (${$platform === 'mac' ? '⌘+D' : 'Ctrl+D'})`"
					data-testid="toolbar-microphone"
				>
					<template #icon>
						<lucide-mic-off v-if="!isMicOn" class="w-5 h-5 text-white" />
						<lucide-mic v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Camera -->
				<Button
					@click="$emit('toggle-camera')"
					variant="solid"
					size="lg"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': !isCameraOn,
					}"
					:title="`Toggle Video (${$platform === 'mac' ? '⌘+E' : 'Ctrl+E'})`"
					data-testid="toolbar-camera"
				>
					<template #icon>
						<lucide-video-off v-if="!isCameraOn" class="w-5 h-5 text-white" />
						<lucide-video v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Screen Share -->
				<Button
					v-if="canScreenShare()"
					@click="$emit('toggle-screen-share')"
					variant="solid"
					size="lg"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
					:class="{
						'!bg-[#e54e17] hover:!bg-[#e54e17]': isScreenSharing,
					}"
					title="Toggle Screen Share"
					data-testid="toolbar-screen-share"
				>
					<template #icon>
						<lucide-monitor-up v-if="!isScreenSharing" class="w-5 h-5 text-white" />
						<lucide-monitor-pause v-else class="w-5 h-5 text-white" />
					</template>
				</Button>

				<!-- Reactions -->
				<ReactionPicker
					:is-open="isReactionPickerOpen"
					:is-hand-raised="isHandRaised"
					@select="handleReactionSelect"
					@toggle-raise-hand="$emit('toggle-raise-hand')"
					@update:open="updateReactionPickerOpen"
				>
					<template #trigger>
						<Button
							variant="solid"
							theme="gray"
							size="lg"
							class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
							:class="{
								'!bg-gray-800 hover:!bg-gray-800': isReactionPickerOpen,
							}"
							title="Reactions & Raise Hand"
							data-testid="toolbar-reactions"
						>
							<template #icon>
								<lucide-smile class="w-5 h-5 text-white" />
							</template>
						</Button>
					</template>
				</ReactionPicker>

				<!-- Chat -->
				<div v-if="!isMobile" class="relative">
					<Button
						@click="$emit('toggle-chat')"
						variant="solid"
						size="lg"
						theme="gray"
						class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
						:class="{
							'!bg-gray-800 hover:!bg-gray-800': isChatOpen,
						}"
						title="Show Chat"
						data-testid="toolbar-chat"
					>
						<template #icon>
							<lucide-message-square-off
								v-if="isChatOpen"
								class="w-5 h-5 text-white"
							/>
							<lucide-message-square v-else class="w-5 h-5 text-white" />
						</template>
					</Button>

					<!-- Unread Badge -->
					<div
						v-if="hasUnread && !isChatOpen"
						class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"
					/>
				</div>

				<!-- People -->
				<div class="relative" v-if="!isMobile">
					<Button
						@click="$emit('toggle-people')"
						variant="solid"
						size="lg"
						theme="gray"
						class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
						:class="{
							'!bg-gray-800 hover:!bg-gray-800': isPeopleOpen,
						}"
						title="Show Participants"
						data-testid="toolbar-people"
					>
						<template #icon>
							<lucide-users class="w-5 h-5 text-white" />
						</template>
					</Button>

					<div
						v-if="lobbyUserCount > 0"
						class="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"
					/>
				</div>

				<!-- More Options -->
				<div class="relative" ref="dropdownContainer" @click="handleDropdownClick">
					<Dropdown :options="moreOptions" placement="top">
						<template #default>
							<Button
								variant="solid"
								theme="gray"
								size="lg"
								class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95"
								title="More options"
								data-testid="toolbar-more"
							>
								<template #icon>
									<lucide-more-horizontal class="w-5 h-5 text-white" />
								</template>
							</Button>
						</template>
					</Dropdown>
				</div>

				<!-- End Call -->
				<Button
					@click="$emit('end-call')"
					variant="solid"
					theme="red"
					size="lg"
					class="!rounded-full p-0 !bg-opacity-90 hover:!bg-opacity-100 transition-all duration-200 hover:scale-105 active:scale-95 !bg-red-600 hover:!bg-red-500"
					title="End Call"
					data-testid="toolbar-end-call"
				>
					<template #icon>
						<lucide-phone-off class="w-5 h-5 text-white" />
					</template>
				</Button>
			</div>
		</div>
	</div>

	<MeetingInfoDialog
		v-model="showMeetingInfoDialog"
		:meetingId="meetingId"
		:meetingTitle="meetingTitle"
	/>

	<SettingsDialog
		v-model="showSettingsDialog"
		:meetingId="meetingId"
		:isPreview="false"
		@device-changed="$emit('device-changed', $event)"
	/>
</template>

<script setup lang="ts">
import { Button, Dropdown } from "frappe-ui";
import {
	type Component,
	computed,
	onMounted,
	onUnmounted,
	ref,
	watch,
} from "vue";
import LucideBug from "~icons/lucide/bug";
import { useE2EEState } from "../composables/useE2EEState";
import { useMeetingDoc } from "../composables/useMeetingDoc";
import { usePlatform } from "../composables/usePlatform";
import { useResponsiveGrid } from "../composables/useResponsiveGrid";
import { autoHideToolbar } from "../data/mediaPreferences";
import { canScreenShare } from "../utils/device";
import MeetingInfoDialog from "./MeetingInfoDialog.vue";
import ReactionPicker from "./ReactionPicker.vue";
import SettingsDialog from "./settings/SettingsDialog.vue";

const $platform = usePlatform();

interface MoreOption {
	icon: string | Component;
	label: string;
	onClick: () => void;
}

const props = defineProps<{
	isChatOpen: boolean;
	isPeopleOpen?: boolean;
	hasUnread?: boolean;
	lobbyUserCount?: number;
	isMicOn: boolean;
	isCameraOn: boolean;
	isScreenSharing: boolean;
	isHandRaised?: boolean;
	isReactionPickerOpen?: boolean;
	meetingId?: string;
	meetingTitle?: string;
	currentUser?: unknown;
	isFullscreen?: boolean;
	cameraPermissionGranted?: boolean;
	microphonePermissionGranted?: boolean;
}>();

const emit = defineEmits<{
	"toggle-chat": [];
	"toggle-people": [];
	"toggle-reactions": [emoji: string];
	"toggle-microphone": [];
	"toggle-camera": [];
	"toggle-screen-share": [];
	"toggle-fullscreen": [];
	"toggle-raise-hand": [];
	"report-problem": [];
	"end-call": [];
	"device-changed": [event: unknown];
	"update:isReactionPickerOpen": [value: boolean];
	"visibility-change": [visible: boolean];
}>();

const { isMobile } = useResponsiveGrid();
const { isContextReady: isE2EEContextReady } = useE2EEState();

const moreOptions = computed(() => [
	{
		icon: "settings",
		label: "Settings",
		onClick: () => {
			showSettingsDialog.value = true;
			resetHideTimer();
		},
	},
	{
		icon: "info",
		label: "Meeting information",
		onClick: () => {
			showMeetingInfoDialog.value = true;
			resetHideTimer();
		},
	},
	{
		icon: props.isFullscreen ? "minimize" : "maximize",
		label: props.isFullscreen ? "Exit full screen" : "Enter full screen",
		onClick: () => {
			emit("toggle-fullscreen");
			resetHideTimer();
		},
	},
	{
		icon: LucideBug,
		label: "Report an issue",
		onClick: () => {
			emit("report-problem");
			resetHideTimer(true);
		},
	},
	...(isMobile.value
		? [
				{
					icon: "users",
					label: "People",
					onClick: () => {
						emit("toggle-people");
						isVisible.value = false;
					},
				},
				{
					icon: "message-square",
					label: "Chat",
					onClick: () => {
						emit("toggle-chat");
						isVisible.value = false;
					},
				},
			]
		: []),
]);

const isVisible = ref(true);
const isHovering = ref(false);
const isDropdownOpen = ref(false);
const dropdownContainer = ref(null);
const showMeetingInfoDialog = ref(false);
const showSettingsDialog = ref(false);
const showMeetingInfoWhenE2EEReady = ref(false);
let hideTimeout = null;

const TOOLBAR_VISIBLE_HEIGHT = "5.5rem";
const toolbarHeight = computed(() =>
	isVisible.value ? TOOLBAR_VISIBLE_HEIGHT : "0px",
);

const showControls = () => {
	isVisible.value = true;
	resetHideTimer();
};

const resetHideTimer = (force = false) => {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}

	if (!autoHideToolbar.value) {
		return;
	}

	if (
		!force &&
		(isDropdownOpen.value || isHovering.value || props.isReactionPickerOpen)
	) {
		return;
	}

	hideTimeout = setTimeout(() => {
		isVisible.value = false;
	}, 10000);
};

const handleActivity = () => {
	showControls();
};

const onMouseEnter = () => {
	isHovering.value = true;
	if (hideTimeout) {
		clearTimeout(hideTimeout);
		hideTimeout = null;
	}
	isVisible.value = true;
};

const onMouseLeave = () => {
	isHovering.value = false;
	resetHideTimer();
};

const handleShortcut = (event) => {
	if (
		(event.ctrlKey || event.metaKey) &&
		["d", "e"].includes(event.key.toLowerCase())
	) {
		showControls();
	}
};

const handleDropdownClick = (_event) => {
	isDropdownOpen.value = !isDropdownOpen.value;

	if (isDropdownOpen.value) {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		isVisible.value = true;
	} else {
		resetHideTimer();
	}
};

const handleDocumentClick = (event) => {
	if (
		dropdownContainer.value &&
		!dropdownContainer.value.contains(event.target)
	) {
		if (isDropdownOpen.value) {
			isDropdownOpen.value = false;
			resetHideTimer();
		}
	}
};

const handleHostE2EEEnabled = () => {
	showMeetingInfoWhenE2EEReady.value = true;
};

const showMeetingInfoForReadyE2EE = () => {
	showMeetingInfoWhenE2EEReady.value = false;
	showMeetingInfoDialog.value = true;
	showControls();
};

const handleReactionSelect = (emoji) => {
	emit("toggle-reactions", emoji);

	isHovering.value = false;
	updateReactionPickerOpen(false);
	resetHideTimer(true);
};

const updateReactionPickerOpen = (value) => {
	emit("update:isReactionPickerOpen", value);
};

watch(isVisible, (val) => emit("visibility-change", val));

watch([showMeetingInfoWhenE2EEReady, isE2EEContextReady], ([shouldShow, ready]) => {
	if (shouldShow && ready) {
		showMeetingInfoForReadyE2EE();
	}
});

watch(autoHideToolbar, (shouldAutoHide) => {
	if (!shouldAutoHide) {
		if (hideTimeout) {
			clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		isVisible.value = true;
	} else {
		resetHideTimer();
	}
});

onMounted(() => {
	resetHideTimer();

	document.addEventListener("mousemove", handleActivity);
	document.addEventListener("mousedown", handleActivity);
	document.addEventListener("touchstart", handleActivity);
	document.addEventListener("touchmove", handleActivity);
	document.addEventListener("keydown", handleShortcut);
	document.addEventListener("click", handleDocumentClick);
	document.addEventListener("meet:e2ee-host-enabled", handleHostE2EEEnabled);
});

onUnmounted(() => {
	if (hideTimeout) {
		clearTimeout(hideTimeout);
	}

	document.removeEventListener("mousemove", handleActivity);
	document.removeEventListener("mousedown", handleActivity);
	document.removeEventListener("touchstart", handleActivity);
	document.removeEventListener("touchmove", handleActivity);
	document.removeEventListener("keydown", handleShortcut);
	document.removeEventListener("click", handleDocumentClick);
	document.removeEventListener("meet:e2ee-host-enabled", handleHostE2EEEnabled);
});
</script>
