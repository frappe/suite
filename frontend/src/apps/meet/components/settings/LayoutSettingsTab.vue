<template>
	<AppSettingsHeader
		title="Layout"
		description="Customize the meeting interface layout"
	/>
	<AppSettingsBody>
		<div class="space-y-6">
			<Switch
				class="w-full !px-0"
				label="Auto-hide header and controls"
				description="Automatically hide the header and toolbar after 10 seconds of inactivity"
				v-model="autoHideToolbarLocal"
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
	autoHideToolbar,
	setAutoHideToolbar,
} from "../../data/mediaPreferences";

const autoHideToolbarLocal: Ref<boolean> = ref(autoHideToolbar.value);

watch(autoHideToolbarLocal, (newValue) => {
	setAutoHideToolbar(newValue);
});

watch(autoHideToolbar, (newValue) => {
	autoHideToolbarLocal.value = newValue;
});
</script>
