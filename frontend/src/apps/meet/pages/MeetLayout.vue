<script setup lang="ts">
import { FrappeUIProvider, Dialogs } from "frappe-ui";
import { provide } from "vue";

import { initSocket } from "@/apps/meet/socket";
import { getPlatform } from "@/apps/meet/utils/device";

/**
 * Meet route-group layout.
 *
 * Maps the standalone app's root App.vue (which wrapped everything in
 * FrappeUIProvider + Dialogs). The suite shell (SuiteLayout / AppContainer)
 * already provides the top-level chrome, so this layout integrates meet's own
 * app-level concerns:
 *   - establishes the socket.io connection (was an initSocket() side-effect in
 *     meet's main.ts; useSocket() consumers read the singleton it creates),
 *   - provides the meet-local `$platform` value (was app.config.globalProperties
 *     in main.ts) for any inject consumers,
 *   - wraps children in FrappeUIProvider + Dialogs and renders <router-view>.
 */
initSocket();

provide("$platform", getPlatform());
</script>

<template>
	<FrappeUIProvider>
		<router-view />
		<Dialogs />
	</FrappeUIProvider>
</template>
