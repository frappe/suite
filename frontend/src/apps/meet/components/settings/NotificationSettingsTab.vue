<template>
	<AppSettingsHeader
		title="Notifications"
		description="Customize notification sounds for meeting events"
	/>
	<AppSettingsBody>
		<div class="divide-y divide-outline-gray-1">
			<SettingsRow
				title="Enable notification sounds"
				description="Play sounds for all meeting events"
			>
				<Switch v-model="notificationChimesEnabledLocal" />
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
