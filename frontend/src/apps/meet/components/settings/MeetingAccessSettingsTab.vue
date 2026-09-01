<template>
	<AppSettingsHeader
		title="Controls"
		description="Manage join rules, chat, and security for this meeting."
	/>
	<AppSettingsBody>
			<div>
				<SettingsRow
					title="Allow Guests"
					description="Allow non-registered users to join this meeting"
				>
					<Switch
						v-model="allowGuest"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.loading"
					/>
				</SettingsRow>

				<SettingsRow
					title="Require host approval"
					description="People wait in the lobby until a host or co-host admits them"
				>
					<Switch
						v-model="requireHostApproval"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.loading"
					/>
				</SettingsRow>

				<SettingsRow
					title="Host Only Chat"
					description="Restrict chat so only hosts and co-hosts can send messages"
				>
					<Switch
						v-model="hostOnlyChat"
						:disabled="meetingDoc.updateSettings.loading || meetingDoc.loading"
					/>
				</SettingsRow>

				<E2EESettingsSection
					:meeting-id="props.meetingId"
					:meeting-doc="meetingDoc"
					:globally-enabled="globalE2EEEnabled"
				/>
			</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import {
	debounce,
	SettingsRow,
	Switch,
	toast,
	useDoc,
} from 'frappe-ui';
import { computed, ref, watch } from "vue";
import { useChatStore } from "@/apps/meet/composables/useChatStore";
import { submit } from "../../utils/request";
import E2EESettingsSection from "./E2EESettingsSection.vue";

const props = defineProps({
	meetingId: {
		type: String,
		required: true,
	},
});

interface MeetingDocument {
	name: string;
	allow_guest?: boolean;
	meeting_type?: string;
	host_only_chat?: boolean;
	e2ee_enabled?: boolean;
}

const meetingDoc = useDoc<MeetingDocument, {
	updateSettings: (params: {
		allow_guest: boolean;
		meeting_type: string;
		host_only_chat: boolean;
	}) => unknown;
	enableE2ee: () => unknown;
}>({
	doctype: "Meet Room",
	name: () => props.meetingId,
	methods: {
		updateSettings: "update_settings",
		enableE2ee: "enable_e2ee",
	},
});
const globalE2EEEnabled = computed(() => Boolean(meetingDoc.doc?.e2ee_enabled));

const chatStore = useChatStore();

const allowGuest = ref(false);
const meetingType = ref("open");
const hostOnlyChat = ref<boolean>(chatStore.hostOnlyChat);

const requireHostApproval = computed({
	get: () => meetingType.value === "restricted",
	set: (enabled: boolean) => {
		meetingType.value = enabled ? "restricted" : "open";
	},
});

let syncingFromDocument = false;
watch(
	() => meetingDoc.doc,
	(doc) => {
		if (!doc) return;
		syncingFromDocument = true;
		allowGuest.value = Boolean(doc.allow_guest);
		meetingType.value = doc.meeting_type || "open";
		hostOnlyChat.value = Boolean(doc.host_only_chat);
		syncingFromDocument = false;
	},
	{ immediate: true },
);

const saveSettings = debounce(async () => {
	if (meetingDoc.updateSettings.loading) return;

	try {
		await submit(meetingDoc.updateSettings, {
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
	if (!syncingFromDocument && !meetingDoc.loading) {
		saveSettings();
	}
}, { flush: "sync" });
</script>
