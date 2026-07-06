<template>
	<SettingsLayoutBase
		:description="'Customize the meeting interface layout'"
	>
		<template #title>
			Layout
		</template>
		<template #content>
			<div class="space-y-6">
				<Switch
					class="w-full !px-0"
					label="Auto-hide header and controls"
					description="Automatically hide the header and toolbar after 10 seconds of inactivity"
					v-model="autoHideToolbarLocal"
				/>
			</div>
		</template>
	</SettingsLayoutBase>
</template>

<script setup lang="ts">
import { Switch } from "frappe-ui";
import { type Ref, ref, watch } from "vue";
import {
	autoHideToolbar,
	setAutoHideToolbar,
} from "../../data/mediaPreferences";
import SettingsLayoutBase from "./SettingsLayoutBase.vue";

const autoHideToolbarLocal: Ref<boolean> = ref(autoHideToolbar.value);

watch(autoHideToolbarLocal, (newValue) => {
	setAutoHideToolbar(newValue);
});

watch(autoHideToolbar, (newValue) => {
	autoHideToolbarLocal.value = newValue;
});
</script>
