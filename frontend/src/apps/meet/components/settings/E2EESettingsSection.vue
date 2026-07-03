<template>
	<div class="space-y-3">
		<Switch
			class="w-full !px-0"
			label="End-to-end encryption"
			:description="e2eeDescription"
			v-model="e2eeEnabled"
			:disabled="isToggleDisabled"
			data-testid="e2ee-toggle"
		/>

	</div>
</template>

<script setup lang="ts">
import { frappeRequest, Switch, toast } from "frappe-ui";
import { computed, onMounted, ref, watch } from "vue";
import { useDeviceIdentity } from "../../composables/useDeviceIdentity";
import { getE2EETransformCapability } from "../../utils/media/e2ee";

interface MeetingDocument {
	allow_guest?: boolean;
	meeting_type?: string;
	e2ee_enabled?: boolean;
	host_only_chat?: boolean;
}

interface E2EESettingsSectionProps {
	meetingId: string;
	meetingDoc: {
		doc?: MeetingDocument;
		reload: () => Promise<void>;
		updateSettings: { loading: boolean };
		enableE2ee: {
			submit: () => Promise<unknown>;
			loading: boolean;
		};
		get: { loading: boolean };
	};
	globallyEnabled: boolean;
}

const props = defineProps<E2EESettingsSectionProps>();

const { getIdentity } = useDeviceIdentity();

const e2eeEnabled = ref<boolean>(props.globallyEnabled);
const isConvertingToE2EE = ref(false);
const isE2EEMediaSupported = ref<boolean | null>(null);

let detailsLoaded = false;

const e2eeDescription = computed(() => {
	if (isE2EEMediaSupported.value === false) {
		return "E2EE requires encoded media transform support. Update your browser to enable it.";
	}
	return "Converts this meeting to E2EE for extra privacy. Only participants can access the meeting content.";
});

const isToggleDisabled = computed(
	() =>
		isConvertingToE2EE.value ||
		props.meetingDoc.updateSettings.loading ||
		props.meetingDoc.enableE2ee.loading ||
		props.meetingDoc.get.loading ||
		e2eeEnabled.value ||
		isE2EEMediaSupported.value !== true,
);

onMounted(async () => {
	try {
		isE2EEMediaSupported.value = getE2EETransformCapability() !== "none";
		e2eeEnabled.value = props.globallyEnabled;
		if (e2eeEnabled.value) {
			await loadE2EEDetails();
		}
	} catch (error) {
		console.error("Failed to load E2EE settings:", error);
	} finally {
		detailsLoaded = true;
	}
});

const loadE2EEDetails = async () => {
	try {
		const response = (await frappeRequest({
			url: "suite.meet.api.meeting.get_meeting_e2ee_details",
			params: { meeting_id: props.meetingId },
		})) as {
			e2ee_enabled?: boolean;
			message?: {
				e2ee_enabled?: boolean;
			};
		};
		const payload = response.message || response;
		e2eeEnabled.value = Boolean(payload.e2ee_enabled);
	} catch (error) {
		console.error("Failed to load E2EE details:", error);
	}
};

const registerE2EEDevice = async (identity: {
	deviceId: string;
	authPublicKey: string;
}): Promise<void> => {
	await frappeRequest({
		url: "suite.meet.api.meeting.register_e2ee_device",
		params: {
			device_id: identity.deviceId,
			ed25519_public_key: identity.authPublicKey,
		},
		method: "POST",
	});
};

watch(e2eeEnabled, async (val, oldVal) => {
	if (!detailsLoaded) return;
	if (!val || oldVal) return;
	if (isConvertingToE2EE.value) return;
	if (getE2EETransformCapability() === "none") {
		e2eeEnabled.value = false;
		isE2EEMediaSupported.value = false;
		toast.error("E2EE requires encoded media transform support.");
		return;
	}

	isConvertingToE2EE.value = true;
	try {
		// Register the device identity used to sign epoch key packages.
		const identity = await getIdentity();
		await registerE2EEDevice(identity);

		await props.meetingDoc.enableE2ee.submit();
		e2eeEnabled.value = true;

		// Broadcast locally after the server-side meeting flag is enabled, so
		// epoch collection runs against SFU/server state that already requires E2EE.
		document.dispatchEvent(
			new CustomEvent("meet:e2ee-host-enabled", {
				detail: {
					keyVersion: "v1-epoch",
				},
			}),
		);

		await props.meetingDoc.reload();
		toast.success("Meeting is now end-to-end encrypted.");
	} catch (error) {
		console.error("Failed to enable E2EE:", error);
		e2eeEnabled.value = false;
		toast.error("Failed to enable E2EE for this meeting");
	} finally {
		isConvertingToE2EE.value = false;
	}
});
</script>
