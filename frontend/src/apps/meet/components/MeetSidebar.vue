<script setup lang="ts">
import {
	Sidebar,
	SidebarCollapseToggle,
	SidebarHeader,
	SidebarItem,
	SidebarSection,
	createResource,
} from "frappe-ui";
import { computed, inject, ref } from "vue";
import { useStorage } from "@vueuse/core";
import { useRoute } from "vue-router";

import { useAppSwitcher } from "@/composables/useAppSwitcher";
import { setupTheme, switchTheme, themeMode } from "@/utils/setupTheme";
import { useSessionStore } from "../../../boot/session";
import FrappeMeetingLogo from "../icons/FrappeMeetingLogo.vue";

import LucideHome from "~icons/lucide/home";
import LucideCalendar from "~icons/lucide/calendar";
import LucideKeyboard from "~icons/lucide/keyboard";
import LucideSunMoon from "~icons/lucide/sun-moon";
import LucideSun from "~icons/lucide/sun";
import LucideMoon from "~icons/lucide/moon";
import LucideMonitor from "~icons/lucide/monitor";
import LucideCheck from "~icons/lucide/check";

const route = useRoute();
const sessionStore = useSessionStore();
setupTheme();

const isCollapsed = useStorage("isSidebarCollapsed", false);

const userResource = createResource({
	url: "suite.api.account.get_logged_in_user",
	cache: "User",
	auto: true,
});

function selectTheme(theme: string) {
	switchTheme(theme);
}

const appsMenuOption = useAppSwitcher("meet");

const userName = computed(
	() => userResource.data?.full_name || userResource.data?.name || "User",
);

const settingsItems = computed(() => [
	{
		group: "Manage",
		hideLabel: true,
		options: [
			appsMenuOption.value,
			{
				icon: LucideKeyboard,
				label: "Shortcuts",
				onClick: () => {
					showShortcutsDialog.value = true;
				},
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
		options: [
			{
				icon: "lucide-log-out",
				label: "Log out",
				onClick: () => sessionStore.logout.submit(),
			},
		],
	},
]);

const showShortcutsDialog = inject(
	"showShortcutsDialog",
	ref(false),
);
</script>

<template>
	<Sidebar
		v-model:collapsed="isCollapsed"
		class="hidden sm:flex"
	>
		<SidebarHeader
			title="Meet"
			:subtitle="userName"
			:menu-items="settingsItems"
			:logo="FrappeMeetingLogo"
		/>
		<div class="flex-1 px-2">
			<SidebarSection>
				<SidebarItem
					label="Home"
					to="/meet"
					:icon="LucideHome"
					:active="route.name === 'meet-home'"
				/>
				<SidebarItem label="Calendar" to="/calendar" :icon="LucideCalendar" />
			</SidebarSection>
		</div>
		<div class="p-2">
			<SidebarCollapseToggle />
		</div>
	</Sidebar>

</template>
