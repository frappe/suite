<script setup lang="ts">
import { FrappeUIProvider, Dialogs } from "frappe-ui";
import { onMounted, onUnmounted, provide } from "vue";

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

let previousTheme: string | null = null;
let previousThemeMode: string | null = null;
let previousBodyTheme: string | null = null;
let previousBodyThemeMode: string | null = null;
let themeObserver: MutationObserver | null = null;

const forceDarkTheme = () => {
	if (document.documentElement.getAttribute("data-theme") !== "dark") {
		document.documentElement.setAttribute("data-theme", "dark");
	}
	if (document.documentElement.getAttribute("data-theme-mode") !== "dark") {
		document.documentElement.setAttribute("data-theme-mode", "dark");
	}
	if (document.body.getAttribute("data-theme") !== "dark") {
		document.body.setAttribute("data-theme", "dark");
	}
	if (document.body.getAttribute("data-theme-mode") !== "dark") {
		document.body.setAttribute("data-theme-mode", "dark");
	}
};

onMounted(() => {
	previousTheme = document.documentElement.getAttribute("data-theme");
	previousThemeMode = document.documentElement.getAttribute("data-theme-mode");
	previousBodyTheme = document.body.getAttribute("data-theme");
	previousBodyThemeMode = document.body.getAttribute("data-theme-mode");
	forceDarkTheme();

	themeObserver = new MutationObserver(forceDarkTheme);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-theme", "data-theme-mode"],
	});
	themeObserver.observe(document.body, {
		attributes: true,
		attributeFilter: ["data-theme", "data-theme-mode"],
	});
});

onUnmounted(() => {
	themeObserver?.disconnect();
	themeObserver = null;

	if (previousTheme) {
		document.documentElement.setAttribute("data-theme", previousTheme);
	} else {
		document.documentElement.removeAttribute("data-theme");
	}

	if (previousThemeMode) {
		document.documentElement.setAttribute("data-theme-mode", previousThemeMode);
	} else {
		document.documentElement.removeAttribute("data-theme-mode");
	}

	if (previousBodyTheme) {
		document.body.setAttribute("data-theme", previousBodyTheme);
	} else {
		document.body.removeAttribute("data-theme");
	}

	if (previousBodyThemeMode) {
		document.body.setAttribute("data-theme-mode", previousBodyThemeMode);
	} else {
		document.body.removeAttribute("data-theme-mode");
	}
});
</script>

<template>
	<FrappeUIProvider>
		<router-view />
		<Dialogs />
	</FrappeUIProvider>
</template>
