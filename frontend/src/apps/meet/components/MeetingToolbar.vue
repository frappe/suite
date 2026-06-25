<template>
	<div
		class="pointer-events-none w-full overflow-hidden shrink-0 transition-[height,margin] duration-500 ease-in-out"
		:style="{ height: toolbarHeight }"
	>
		<div
			class="flex h-full items-end justify-center px-4 transition-transform duration-500 ease-in-out"
			:class="isVisible ? 'translate-y-0' : 'translate-y-full'"
		>
			<div
				class="flex items-center gap-1.5 pointer-events-auto transition-all duration-500 px-2 py-1"
				@mouseenter="onMouseEnter"
				@mouseleave="onMouseLeave"
				data-testid="meeting-toolbar"
			>
				<!-- Microphone -->
				<ToolbarButton
					:title="`Toggle Audio (${$platform === 'mac' ? '⌘+D' : 'Ctrl+D'})`"
					test-id="toolbar-microphone"
					@click="$emit('toggle-microphone')"
				>
					<lucide-mic-off v-if="!isMicOn" class="w-4 h-4" />
					<lucide-mic v-else class="w-4 h-4" />
				</ToolbarButton>

				<!-- Camera -->
				<ToolbarButton
					:title="`Toggle Video (${$platform === 'mac' ? '⌘+E' : 'Ctrl+E'})`"
					test-id="toolbar-camera"
					@click="$emit('toggle-camera')"
				>
					<lucide-video-off v-if="!isCameraOn" class="w-4 h-4" />
					<lucide-video v-else class="w-4 h-4" />
				</ToolbarButton>

				<!-- Screen Share -->
				<ToolbarButton
					v-if="canScreenShare()"
					title="Toggle Screen Share"
					test-id="toolbar-screen-share"
					@click="$emit('toggle-screen-share')"
				>
					<lucide-monitor-up v-if="!isScreenSharing" class="w-4 h-4" />
					<lucide-monitor-pause v-else class="w-4 h-4" />
				</ToolbarButton>

				<!-- Reactions -->
				<ReactionPicker
					:is-open="isReactionPickerOpen"
					:is-hand-raised="isHandRaised"
					@select="handleReactionSelect"
					@toggle-raise-hand="$emit('toggle-raise-hand')"
					@update:open="updateReactionPickerOpen"
				>
					<template #trigger>
						<ToolbarButton
							title="Reactions & Raise Hand"
							test-id="toolbar-reactions"
							@click="() => {}"
						>
							<lucide-smile class="w-4 h-4" />
						</ToolbarButton>
					</template>
				</ReactionPicker>

				<!-- Chat -->
				<ToolbarButton
					:active="isChatOpen"
					title="Show Chat"
					test-id="toolbar-chat"
					@click="$emit('toggle-chat')"
				>
					<lucide-message-square-off v-if="isChatOpen" class="w-4 h-4" />
					<lucide-message-square v-else class="w-4 h-4" />
					<span
						v-if="hasUnread && !isChatOpen"
						class="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full"
					/>
				</ToolbarButton>

				<!-- People -->
				<ToolbarButton
					:active="isPeopleOpen"
					title="Show Participants"
					test-id="toolbar-people"
					@click="$emit('toggle-people')"
				>
					<lucide-users class="w-4 h-4" />
					<span
						v-if="lobbyUserCount && lobbyUserCount > 0"
						class="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full"
					/>
				</ToolbarButton>

				<!-- More Options -->
				<div class="relative" ref="dropdownContainer" @click="handleDropdownClick">
					<Dropdown :options="moreOptions" placement="top">
						<template #default="{ open }">
							<button
								type="button"
								title="More options"
								data-testid="toolbar-more"
								class="relative flex h-11 w-11 items-center justify-center rounded-[12px] bg-white/10 backdrop-blur-[10px] transition-all duration-200 [&_svg]:text-ink-gray-9 hover:bg-white/15"
								:class="open ? 'bg-white/20' : ''"
							>
								<lucide-more-horizontal class="w-4 h-4" />
							</button>
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
					<lucide-phone-off class="w-4 h-4" />
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
import { Dropdown } from "frappe-ui";
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
					},
				},
				{
					icon: "message-square",
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
const isDropdownOpen = ref(false);
const dropdownContainer = ref(null);
const showMeetingInfoDialog = ref(false);
const showSettingsDialog = ref(false);
const showMeetingInfoWhenE2EEReady = ref(false);
let hideTimeout = null;

const TOOLBAR_VISIBLE_HEIGHT = "3.25rem";
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
