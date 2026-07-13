<template>
	<UiSettingsDialog
		v-model="show"
		v-model:tab="activeTabValue"
		size="5xl"
		:shortcut="false"
	>
		<template #title>Settings</template>
		<SettingsSidebar>
			<SettingsNavGroup
				v-for="group in tabs"
				:key="group.label"
				:label="group.label"
			>
				<SettingsNavItem
					v-for="item in group.items"
					:key="item.value"
					:value="item.value"
				>
					<template #prefix>
						<component
							:is="item.icon"
							class="size-4 shrink-0 text-ink-gray-6"
						/>
					</template>
					{{ item.label }}
				</SettingsNavItem>
			</SettingsNavGroup>
		</SettingsSidebar>
		<SettingsContent>
			<SettingsPanel
				v-for="item in flatTabs"
				:key="item.value"
				:value="item.value"
			>
				<component
					:is="item.component"
					@device-changed="$emit('device-changed', $event)"
					:is-visible="show && activeTabValue === item.value"
					:meeting-id="meetingId"
				/>
			</SettingsPanel>
		</SettingsContent>
	</UiSettingsDialog>
</template>

<script setup lang="ts">
import {
	SettingsContent,
	SettingsDialog as UiSettingsDialog,
	SettingsNavGroup,
	SettingsNavItem,
	SettingsPanel,
	SettingsSidebar,
} from "frappe-ui";
import { type Component, computed, h, markRaw, ref, watch } from "vue";
import LucideAudioLines from "~icons/lucide/audio-lines";
import LucideBell from "~icons/lucide/bell";
import LucideCamera from "~icons/lucide/camera";
import LucideLayoutDashboard from "~icons/lucide/layout-dashboard";
import LucideMonitorSmartphone from "~icons/lucide/monitor-smartphone";
import LucideUser from "~icons/lucide/user";
import { useMeetingDoc } from "../../composables/useMeetingDoc";
import AudioSettingsTab from "./AudioSettingsTab.vue";
import BackgroundSettingsTab from "./BackgroundSettingsTab.vue";
import DeviceSettingsTab from "./DeviceSettingsTab.vue";
import LayoutSettingsTab from "./LayoutSettingsTab.vue";
import MeetingAccessSettingsTab from "./MeetingAccessSettingsTab.vue";
import NotificationSettingsTab from "./NotificationSettingsTab.vue";

interface TabItem {
	label: string;
	value: string;
	icon: Component;
	component: ReturnType<typeof markRaw>;
	condition?: () => boolean;
}

interface TabGroup {
	label: string;
	items: TabItem[];
}

const props = defineProps<{
	modelValue?: boolean;
	meetingId?: string;
	isPreview?: boolean;
}>();

const emit = defineEmits<{
	"device-changed": [event: unknown];
	"update:modelValue": [value: boolean];
}>();

const { isCurrentUserHost, isCurrentUserCohost, getMeetingDoc } =
	useMeetingDoc();

// sometimes we won't see meeting access tab right after creating a meeting
// this loads the meeting doc to avoid that
if (props.meetingId) {
	getMeetingDoc(props.meetingId);
}

const show = computed({
	get: () => props.modelValue,
	set: (value) => emit("update:modelValue", value),
});

function isTabVisible(tab: TabItem) {
	return typeof tab.condition === "function" ? tab.condition() : true;
}

const tabs = computed((): TabGroup[] => {
	const allTabs: TabGroup[] = [];

	if (
		(isCurrentUserHost.value || isCurrentUserCohost.value) &&
		!props.isPreview
	) {
		allTabs.push({
			label: "Meeting",
			items: [
				{
					label: "Controls",
					value: "meeting-access",
					icon: h(LucideUser),
					component: markRaw(MeetingAccessSettingsTab),
				},
			],
		});
	}

	allTabs.push(
		{
			label: "Media",
			items: [
				{
					label: "Devices",
					value: "devices",
					icon: h(LucideMonitorSmartphone),
					component: markRaw(DeviceSettingsTab),
				},
				{
					label: "Audio",
					value: "audio",
					icon: h(LucideAudioLines),
					component: markRaw(AudioSettingsTab),
				},
				{
					label: "Background",
					value: "background",
					icon: h(LucideCamera),
					component: markRaw(BackgroundSettingsTab),
				},
			],
		},
		{
			label: "Interface",
			items: [
				{
					label: "Notifications",
					value: "notifications",
					icon: h(LucideBell),
					component: markRaw(NotificationSettingsTab),
				},
				{
					label: "Layout",
					value: "layout",
					icon: h(LucideLayoutDashboard),
					condition: () => !props.isPreview,
					component: markRaw(LayoutSettingsTab),
				},
			],
		},
	);

	return allTabs
		.map((group) => ({
			...group,
			items: group.items.filter(isTabVisible),
		}))
		.filter((group) => group.items.length > 0);
});

const flatTabs = computed(() =>
	tabs.value.flatMap((group) => group.items),
);

const activeTabValue = ref<string | undefined>(undefined);

watch(
	flatTabs,
	(newTabs) => {
		if (!newTabs.length) {
			activeTabValue.value = undefined;
			return;
		}

		if (!newTabs.some((tab) => tab.value === activeTabValue.value)) {
			activeTabValue.value = newTabs[0].value;
		}
	},
	{ immediate: true },
);
</script>
