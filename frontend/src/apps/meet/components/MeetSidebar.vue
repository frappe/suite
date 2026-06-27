<script setup lang="ts">
import { Sidebar, createResource } from "frappe-ui";
import { computed, h, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { useRoute } from "vue-router";

import { useSessionStore } from "../../../boot/session";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";
import AppearanceSettingsDialog from "./AppearanceSettingsDialog.vue";

import LucideHome from "~icons/lucide/home";
import LucideCalendar from "~icons/lucide/calendar";
import LucideSettings from "~icons/lucide/settings";
import LucideBadgeHelp from "~icons/lucide/badge-help";
import LucideBook from "~icons/lucide/book";
import LucideLayoutGrid from "~icons/lucide/layout-grid";

const route = useRoute();
const sessionStore = useSessionStore();

const isCollapsed = useStorage("meet-sidebar-collapsed", false);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

const apps = createResource({
	url: "frappe.apps.get_apps",
	cache: "apps",
	auto: true,
	transform: (data: any[]) => {
		const list = [
			{
				name: "frappe",
				logo: "/assets/frappe/images/framework.png",
				title: "Desk",
				route: "/app",
			},
		];
		for (const app of data) {
			if (app.name === "meet") continue;
			list.push({
				name: app.name,
				logo: app.logo,
				title: app.title,
				route: app.route,
			});
		}
		return list;
	},
});

const userName = computed(
	() => userResource.data?.full_name || userResource.data?.name || "User",
);

function openHelp() {
	window.open("https://docs.frappe.io/meet", "_blank");
}

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
				icon: LucideBook,
				label: "Documentation",
				onClick: openHelp,
			},
			{
				icon: LucideBadgeHelp,
				label: "Support",
				onClick: () => window.open("https://t.me/frappe", "_blank"),
			},
		],
	},
	{
		group: "Others",
		hideLabel: true,
		items: [
			{
				icon: "log-out",
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
			{
				label: "Settings",
				onClick: () => (showSettingsDialog.value = true),
				icon: LucideSettings,
			},
		],
	},
]);

const showSettingsDialog = ref(false);
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
	>
		<template #footer-items="{ isCollapsed }">
			<div class="flex items-center gap-1 px-1 py-1">
				<button
					class="flex items-center justify-center p-1.5 rounded-lg hover:bg-surface-gray-2 text-ink-gray-7"
					@click="openHelp"
					:title="isCollapsed ? 'Help' : ''"
				>
					<LucideBadgeHelp class="size-4" />
				</button>
			</div>
		</template>
	</Sidebar>

	<AppearanceSettingsDialog v-model="showSettingsDialog" />
</template>
