<template>
	<AppSettingsHeader
		title="Notifications"
		description="Customize notification sounds for meeting events"
	/>
	<AppSettingsBody>
		<div class="space-y-6">
			<Switch
				class="w-full"
				label="Enable notification sounds"
				description="Play sounds for all meeting events"
				v-model="notificationChimesEnabledLocal"
			/>
		</div>
	</AppSettingsBody>
</template>

<script setup lang="ts">
import AppSettingsHeader from '@/components/settings/AppSettingsHeader.vue'
import AppSettingsBody from '@/components/settings/AppSettingsBody.vue'
import { Switch } from "frappe-ui";
import { type Ref, ref, watch } from "vue";
import {
	notificationChimesEnabled,
	setNotificationChimesEnabled,
} from "../../data/notificationPreferences";

const notificationChimesEnabledLocal: Ref<boolean> = ref(
	notificationChimesEnabled.value,
);

watch(notificationChimesEnabledLocal, (newValue) => {
	setNotificationChimesEnabled(newValue);
});
</script>
