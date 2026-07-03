<template>
	<div
		class="pointer-events-none w-full overflow-hidden shrink-0 transition-[height,margin] duration-500 ease-in-out"
		:class="isVisible ? 'h-[3.75rem]' : 'h-0'"
	>
		<div
			class="grid h-full w-full grid-cols-[1fr_auto_1fr] items-end px-4 transition-transform duration-500 ease-in-out pb-2"
			:class="isVisible ? 'translate-y-0' : 'translate-y-full'"
		>
			<div
				class="col-start-2 flex items-center gap-1.5 pointer-events-auto transition-all duration-500 px-2 py-1"
				role="toolbar"
				aria-label="Meeting controls"
				@mouseenter="onMouseEnter"
				@mouseleave="onMouseLeave"
				data-testid="meeting-toolbar"
			>
				<!-- Microphone -->
				<ToolbarButton
					:variant="isMicOn ? 'default' : 'muted'"
					:title="`Toggle Audio (${$platform === 'mac' ? '⌘+D' : 'Ctrl+D'})`"
					test-id="toolbar-microphone"
					@click="$emit('toggle-microphone')"
				>
					<MeetMicIcon v-if="isMicOn" />
					<MeetMicOffIcon v-else />
				</ToolbarButton>

				<!-- Camera -->
				<ToolbarButton
					:variant="isCameraOn ? 'default' : 'muted'"
					:title="`Toggle Video (${$platform === 'mac' ? '⌘+E' : 'Ctrl+E'})`"
					test-id="toolbar-camera"
					@click="$emit('toggle-camera')"
				>
					<MeetCameraIcon v-if="isCameraOn" />
					<MeetCameraOffIcon v-else />
				</ToolbarButton>

				<!-- Screen Share -->
				<ToolbarButton
					v-if="canScreenShare()"
					:active="isScreenSharing"
					:variant="isScreenSharing ? 'muted' : 'default'"
					title="Toggle Screen Share"
					test-id="toolbar-screen-share"
					@click="$emit('toggle-screen-share')"
				>
					<MeetPresentPauseIcon v-if="isScreenSharing" />
					<MeetPresentIcon v-else />
				</ToolbarButton>

				<!-- Raise Hand -->
				<ToolbarButton
					:variant="isHandRaised ? 'muted' : 'default'"
					title="Raise Hand"
					test-id="toolbar-raise-hand"
					@click="$emit('toggle-raise-hand')"
				>
					<MeetHandIcon />
				</ToolbarButton>

				<!-- Reactions -->
				<ReactionPicker
					:is-open="isReactionPickerOpen"
					@select="handleReactionSelect"
					@update:open="updateReactionPickerOpen"
				>
					<template #trigger>
						<ToolbarButton
							title="Reactions"
							test-id="toolbar-reactions"
							@click="() => {}"
						>
							<MeetSmileIcon />
						</ToolbarButton>
					</template>
				</ReactionPicker>

				<!-- More Options -->
				<div class="relative">
					<Dropdown :options="moreOptions" placement="top">
						<template #default>
							<Button
								size="lg"
								variant="ghost"
								data-testid="toolbar-more"
								tooltip="More options"
							>
								<template #icon>
									<MeetSettingsIcon />
								</template>
							</Button>
						</template>
					</Dropdown>
				</div>

				<!-- End Call -->
				<ToolbarButton
					variant="active"
					title="End Call"
					test-id="toolbar-end-call"
					@click="$emit('end-call')"
				>
					<MeetPhoneOffIcon />
				</ToolbarButton>
			</div>

			<div
				class="col-start-3 flex items-center justify-self-end gap-1.5 pointer-events-auto transition-all duration-500 px-2 py-1"
				role="group"
				aria-label="Meeting side panels"
				@mouseenter="onMouseEnter"
				@mouseleave="onMouseLeave"
			>
				<!-- People -->
				<ToolbarButton
					v-if="!isMobile"
					:active="isPeopleOpen"
					:variant="isPeopleOpen ? 'muted' : 'default'"
					title="Show Participants"
					test-id="toolbar-people"
					@click="$emit('toggle-people')"
				>
					<MeetPeopleIcon />
					<span
						v-if="lobbyUserCount && lobbyUserCount > 0"
						class="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full"
					/>
				</ToolbarButton>

				<!-- Chat -->
				<ToolbarButton
					v-if="!isMobile"
					:active="isChatOpen"
					:variant="isChatOpen ? 'muted' : 'default'"
					title="Show Chat"
					test-id="toolbar-chat"
					@click="$emit('toggle-chat')"
				>
					<MeetChatIcon />
					<span
						v-if="hasUnread && !isChatOpen"
						data-testid="toolbar-chat-unread"
						class="absolute top-2 right-2 w-1.5 h-1.5 bg-red-500 rounded-full"
					/>
				</ToolbarButton>
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
import MeetCameraIcon from "../icons/MeetCameraIcon.vue";
import MeetCameraOffIcon from "../icons/MeetCameraOffIcon.vue";
import MeetChatIcon from "../icons/MeetChatIcon.vue";
import MeetMicIcon from "../icons/MeetMicIcon.vue";
import MeetHandIcon from "../icons/MeetHandIcon.vue";
import MeetMicOffIcon from "../icons/MeetMicOffIcon.vue";
import MeetPeopleIcon from "../icons/MeetPeopleIcon.vue";
import MeetPhoneOffIcon from "../icons/MeetPhoneOffIcon.vue";
import MeetPresentIcon from "../icons/MeetPresentIcon.vue";
import MeetPresentPauseIcon from "../icons/MeetPresentPauseIcon.vue";
import MeetSettingsIcon from "../icons/MeetSettingsIcon.vue";
import MeetSmileIcon from "../icons/MeetSmileIcon.vue";
import { canScreenShare } from "../utils/device";
import MeetingInfoDialog from "./MeetingInfoDialog.vue";
import ReactionPicker from "./ReactionPicker.vue";
import SettingsDialog from "./settings/SettingsDialog.vue";
import ToolbarButton from "./ToolbarButton.vue";

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
		icon: "lucide-settings",
		label: "Settings",
		onClick: () => {
			showSettingsDialog.value = true;
			resetHideTimer();
		},
	},
	{
		icon: "lucide-info",
		label: "Meeting information",
		onClick: () => {
			showMeetingInfoDialog.value = true;
			resetHideTimer();
		},
	},
	{
		icon: props.isFullscreen ? "lucide-minimize" : "lucide-maximize",
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
					icon: "lucide-users",
					label: "People",
					onClick: () => {
						emit("toggle-people");
					},
				},
				{
					icon: "lucide-message-square",
					label: "Chat",
					onClick: () => {
						emit("toggle-chat");
					},
				},
			]
		: []),
]);

const isVisible = ref(true);
const isHovering = ref(false);
const showMeetingInfoDialog = ref(false);
const showSettingsDialog = ref(false);
const showMeetingInfoWhenE2EEReady = ref(false);
let hideTimeout = null;

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
		(isHovering.value || props.isReactionPickerOpen)
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
	document.removeEventListener("meet:e2ee-host-enabled", handleHostE2EEEnabled);
});
</script>
