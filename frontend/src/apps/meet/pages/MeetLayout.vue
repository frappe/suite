<script setup lang="ts">
import { FrappeUIProvider, Dialogs, KeyboardShortcutsModal, useShortcut } from "frappe-ui";
import { computed, provide, ref } from "vue";
import { useRoute } from "vue-router";

import { useKeyboardShortcuts } from "@/apps/meet/composables/useKeyboardShortcuts";
import { initSocket } from "@/apps/meet/socket";
import { getPlatform } from "@/apps/meet/utils/device";

initSocket();

provide("$platform", getPlatform());

const route = useRoute();
const isInMeeting = computed(() => route.name === "meet-meeting");

useKeyboardShortcuts(() => isInMeeting.value);

const showShortcutsDialog = ref(false);
provide("showShortcutsDialog", showShortcutsDialog);

useShortcut({
	key: "?",
	description: "View shortcuts",
	group: "General",
	allowInDialog: true,
	handler: () => (showShortcutsDialog.value = true),
});
</script>

<template>
	<FrappeUIProvider>
		<router-view />
		<Dialogs />
		<KeyboardShortcutsModal v-model:open="showShortcutsDialog" />
	</FrappeUIProvider>
</template>
