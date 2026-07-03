<script setup lang="ts">
import { KeyboardShortcutsModal, Sidebar, createResource, useShortcut } from "frappe-ui";
import { computed, h, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { useRoute } from "vue-router";

import { getAppSwitcherItems } from "@/apps/registry";
import { useSessionStore } from "../../../boot/session";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

import LucideHome from "~icons/lucide/home";
import LucideCalendar from "~icons/lucide/calendar";
import LucideKeyboard from "~icons/lucide/keyboard";
import LucideLayoutGrid from "~icons/lucide/layout-grid";

const route = useRoute();
const sessionStore = useSessionStore();

const isCollapsed = useStorage("meet-sidebar-collapsed", true);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

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

const showShortcutsDialog = ref(false);

useShortcut({
	key: "?",
	description: "View shortcuts",
	group: "General",
	allowInDialog: true,
	handler: () => (showShortcutsDialog.value = true),
});
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

	<KeyboardShortcutsModal v-model:open="showShortcutsDialog" />
</template>
