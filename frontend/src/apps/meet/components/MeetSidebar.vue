<script setup lang="ts">
import { Sidebar, createResource, frappeRequest } from "frappe-ui";
import { computed, h, inject, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { useRoute } from "vue-router";

import { getAppSwitcherItems } from "@/apps/registry";
import { useSessionStore } from "../../../boot/session";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

import LucideHome from "~icons/lucide/home";
import LucideCalendar from "~icons/lucide/calendar";
import LucideKeyboard from "~icons/lucide/keyboard";
import LucideLayoutGrid from "~icons/lucide/layout-grid";
import LucideSunMoon from "~icons/lucide/sun-moon";
import LucideSun from "~icons/lucide/sun";
import LucideMoon from "~icons/lucide/moon";
import LucideMonitor from "~icons/lucide/monitor";
import LucideCheck from "~icons/lucide/check";

const route = useRoute();
const sessionStore = useSessionStore();

const isCollapsed = useStorage("meet-sidebar-collapsed", true);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

function getThemeMode() {
	return document.documentElement.getAttribute("data-theme-mode") || "light";
}

function applyTheme(mode: string) {
	const root = document.documentElement;
	const preference = mode.toLowerCase();
	const resolved =
		preference === "automatic"
			? window.matchMedia("(prefers-color-scheme: dark)").matches
				? "dark"
				: "light"
			: preference;
	root.style.colorScheme = resolved;
	root.setAttribute("data-theme", resolved);
	root.setAttribute("data-theme-mode", preference);
}

function switchTheme(theme: string) {
	applyTheme(theme);
	if (sessionStore.isLoggedIn) {
		frappeRequest({
			url: "frappe.core.doctype.user.user.switch_theme",
			params: { theme },
		});
	}
}

const themeMode = ref(getThemeMode());

function selectTheme(theme: string) {
	switchTheme(theme);
	themeMode.value = theme.toLowerCase();
}

const apps = { get data() { return getAppSwitcherItems("meet"); } };

const userName = computed(
	() => userResource.data?.full_name || userResource.data?.name || "User",
);

const settingsItems = computed(() => [
	{
		group: "Manage",
		hideLabel: true,
		items: [
			{
				icon: LucideLayoutGrid,
				label: "Apps",
				submenu:
					apps.data?.map((app: any) => ({
						label: app.title,
						icon: app.logo,
						component: h(
							"a",
							{
								class:
									"flex items-center gap-2 p-1.5 rounded hover:bg-surface-gray-2",
								href: app.route,
							},
							[
								h("img", { src: app.logo, class: "size-6" }),
								h(
									"span",
									{
										class:
											"max-w-18 text-sm w-full truncate text-ink-gray-9",
									},
									app.title,
								),
							],
						),
					})) || [],
			},
			{
				icon: LucideKeyboard,
				label: "Shortcuts",
				onClick: () => (showShortcutsDialog.value = true),
			},
			{
				icon: LucideSunMoon,
				label: "Theme",
				submenu: [
					{
						label: "Light",
						icon: themeMode.value === "light" ? LucideCheck : LucideSun,
						onClick: () => selectTheme("Light"),
					},
					{
						label: "Dark",
						icon: themeMode.value === "dark" ? LucideCheck : LucideMoon,
						onClick: () => selectTheme("Dark"),
					},
					{
						label: "Automatic",
						icon: themeMode.value === "automatic" ? LucideCheck : LucideMonitor,
						onClick: () => selectTheme("Automatic"),
					},
				],
			},
		],
	},
	{
		group: "Others",
		hideLabel: true,
		items: [
			{
				icon: "lucide-log-out",
				label: "Log out",
				onClick: () => sessionStore.logout.submit(),
			},
		],
	},
]);

const sidebarSections = computed(() => [
	{
		items: [
			{
				label: "Home",
				to: "/meet",
				icon: LucideHome,
				isActive: route.name === "meet-home",
			},
			{
				label: "Calendar",
				to: "/calendar",
				icon: LucideCalendar,
			},
		],
	},
]);

const showShortcutsDialog = inject("showShortcutsDialog") as unknown as ReturnType<typeof ref<boolean>>;
</script>

<template>
	<Sidebar
		v-model:collapsed="isCollapsed"
		class="hidden sm:flex"
		:header="{
			title: 'Meet',
			subtitle: userName,
			menuItems: settingsItems,
			logo: FrappeMeetingLogo,
		}"
		:sections="sidebarSections"
	/>

</template>
