<template>
	<SettingsLayoutBase
		title="Meeting Access"
		description="Manage how participants can join and interact in the meeting."
	>
		<template #content>
			<div class="space-y-6">
				<!-- Allow Guest Toggle -->
				<div class="space-y-3">
					<Switch
						class="w-full !px-0"
						label="Allow Guests"
						description="Allow non-registered users to join this meeting"
						v-model="allowGuest"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<!-- Meeting Type Selector -->
				<div>
					<FormControl
						v-model="meetingType"
						type="select"
						label="Control who can join this meeting"
						:options="[
							{
								label: 'Open - Anyone can join directly',
								value: 'open',
							},
							{
								label: 'Restricted - Requires host approval',
								value: 'restricted',
							},
						]"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<div class="space-y-3">
					<Switch
						class="w-full !px-0"
						label="Host Only Chat"
						description="Restrict chat so only hosts and co-hosts can send messages"
						v-model="hostOnlyChat"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.get.loading"
					/>
				</div>

				<!-- E2EE Toggle -->
				<E2EESettingsSection
					:meeting-id="props.meetingId"
					:meeting-doc="meetingDoc"
					:globally-enabled="globalE2EEEnabled"
				/>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { debounce, FormControl, Switch, toast } from "frappe-ui";
import { onMounted, ref, watch } from "vue";
import { useChatStore } from "@/apps/meet/composables/useChatStore";
import { useMeetingDoc } from "../../composables/useMeetingDoc";
import E2EESettingsSection from "./E2EESettingsSection.vue";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const props = defineProps({
	meetingId: {
		type: String,
		required: true,
	},
});

const {
	getMeetingDoc,
	allowGuest: globalAllowGuest,
	meetingType: globalMeetingType,
	e2eeEnabled: globalE2EEEnabled,
} = useMeetingDoc();

const chatStore = useChatStore();

const allowGuest = ref<boolean>(globalAllowGuest.value);
const meetingType = ref<string>(globalMeetingType.value);
const hostOnlyChat = ref<boolean>(chatStore.hostOnlyChat);

const meetingDoc = getMeetingDoc(props.meetingId);

onMounted(async () => {
	try {
		allowGuest.value = globalAllowGuest.value;
		meetingType.value = globalMeetingType.value;
		if (meetingDoc.doc?.host_only_chat !== undefined) {
			hostOnlyChat.value = !!meetingDoc.doc.host_only_chat;
		}
	} catch (error) {
		console.error("Failed to load meeting settings");
	}
});

const saveSettings = debounce(async () => {
	if (meetingDoc.updateSettings.loading) return;

	try {
		await meetingDoc.updateSettings.submit({
			allow_guest: allowGuest.value,
			meeting_type: meetingType.value,
			host_only_chat: hostOnlyChat.value,
		});

		await meetingDoc.reload();
	} catch (error) {
		console.error("Failed to update meeting settings:", error);
		toast.error("Failed to update meeting settings");

		if (meetingDoc.doc?.host_only_chat !== undefined) {
			hostOnlyChat.value = !!meetingDoc.doc.host_only_chat;
		}
	}
}, 300);

watch(hostOnlyChat, (newValue) => {
	chatStore.hostOnlyChat = newValue;
});
watch([allowGuest, meetingType, hostOnlyChat], () => {
	if (!meetingDoc.get.loading) {
		saveSettings();
	}
});
</script>
