<template>
	<SettingsRow title="End-to-end encryption" :description="e2eeDescription">
		<Switch
			v-model="e2eeEnabled"
			:disabled="isToggleDisabled"
			data-testid="e2ee-toggle"
		/>
	</SettingsRow>
</template>

<script setup lang="ts">
import { SettingsRow, Switch, toast, useCall } from "frappe-ui";
import { computed, onMounted, ref, watch } from "vue";
import { useDeviceIdentity } from "../../composables/useDeviceIdentity";
import { getE2EETransformCapability } from "../../utils/media/e2ee";
import { submit, type Call } from "../../utils/request";

interface E2EESettingsSectionProps {
	meetingId: string;
	meetingDoc: {
		reload: () => Promise<void>;
		updateSettings: { loading: boolean };
		enableE2ee: Call<unknown> & { loading: boolean };
		loading: boolean;
	};
	globallyEnabled: boolean;
}

const props = defineProps<E2EESettingsSectionProps>();

const { getIdentity } = useDeviceIdentity();
const registerE2EEDeviceCall = useCall<unknown, {
	device_id: string;
	ed25519_public_key: string;
}>({
	url: "/api/v2/method/suite.meet.api.meeting.register_e2ee_device",
	method: "POST",
	immediate: false,
});

const e2eeEnabled = ref<boolean>(props.globallyEnabled);
const isConvertingToE2EE = ref(false);
const isE2EEMediaSupported = ref<boolean | null>(null);

let syncingFromDocument = false;

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
		props.meetingDoc.loading ||
		e2eeEnabled.value ||
		isE2EEMediaSupported.value !== true,
);

onMounted(() => {
	isE2EEMediaSupported.value = getE2EETransformCapability() !== "none";
});

watch(
	() => props.globallyEnabled,
	(enabled) => {
		syncingFromDocument = true;
		e2eeEnabled.value = enabled;
		syncingFromDocument = false;
	},
	{ immediate: true },
);

watch(e2eeEnabled, async (val, oldVal) => {
	if (syncingFromDocument) return;
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
		await submit(registerE2EEDeviceCall, {
			device_id: identity.deviceId,
			ed25519_public_key: identity.authPublicKey,
		});

		await submit(props.meetingDoc.enableE2ee);
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
}, { flush: "sync" });
</script>
