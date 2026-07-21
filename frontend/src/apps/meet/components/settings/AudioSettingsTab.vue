<template>
	<AppSettingsHeader
		title="Audio"
		description="Configure your audio and microphone settings"
	/>
	<AppSettingsBody>
		<div>
			<SettingsRow
				title="Noise Cancellation"
				description="Reduce background noise from your microphone"
			>
				<Switch v-model="noiseCancellationEnabledLocal" />
			</SettingsRow>
			<SettingsRow
				title="Push to Talk"
				description="Hold spacebar to unmute your microphone"
			>
				<Switch v-model="pushToTalkEnabledLocal" />
			</SettingsRow>
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { SettingsRow, Switch } from "frappe-ui";
import { type Ref, ref, watch } from "vue";
import {
	noiseCancellationEnabled,
	pushToTalkEnabled,
	setNoiseCancellationEnabled,
	setPushToTalkEnabled,
} from "../../data/mediaPreferences";

const noiseCancellationEnabledLocal: Ref<boolean> = ref(
	noiseCancellationEnabled.value,
);

watch(noiseCancellationEnabledLocal, (newValue) => {
	setNoiseCancellationEnabled(newValue);
});

watch(noiseCancellationEnabled, (newValue) => {
	noiseCancellationEnabledLocal.value = newValue;
});

const pushToTalkEnabledLocal: Ref<boolean> = ref(pushToTalkEnabled.value);

watch(pushToTalkEnabledLocal, (newValue) => {
	setPushToTalkEnabled(newValue);
});

watch(pushToTalkEnabled, (newValue) => {
	pushToTalkEnabledLocal.value = newValue;
});
</script>
