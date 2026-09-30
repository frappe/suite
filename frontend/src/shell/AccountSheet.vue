<!--
  The phone account sheet, opened from the avatar in the bottom nav [T010]:
  who is signed in, then Settings, Theme and Log out. The sheet shows no title,
  so a visually hidden one names the dialog "Account".

  Between the flips an Apps row drills in to the old pages the rail cannot
  reach [T018]. Both views share one grid cell, so the sheet keeps its height.
-->
<template>
  <BottomSheet :open="open" @update:open="$emit('update:open', $event)">
    <div class="grid px-4 pb-8">
      <DialogTitle class="sr-only">{{ __("Account") }}</DialogTitle>
      <div
        class="col-start-1 row-start-1"
        :class="{ invisible: appsOpen }"
        :inert="appsOpen || undefined"
      >
        <div class="flex items-center gap-3 px-1 pb-4">
          <Avatar size="3xl" :image="user?.avatar ?? undefined" :label="name" />
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="truncate text-lg font-semibold text-ink-gray-9">{{ name }}</span>
            <span v-if="email" class="truncate text-sm text-ink-gray-5">{{ email }}</span>
          </div>
        </div>

        <nav class="space-y-0.5" :aria-label="__('Account')">
          <SidebarItem
            v-if="legacyApps"
            :label="__('Apps')"
            icon="lucide-layout-grid"
            @click="appsOpen = true"
          >
            <template #suffix>
              <span class="lucide-chevron-right mr-2 size-4 text-ink-gray-5" aria-hidden="true" />
            </template>
          </SidebarItem>
          <SidebarItem :label="__('Settings')" icon="lucide-settings" @click="showSettings" />
          <div class="flex h-7 items-center justify-between gap-3 pl-2">
            <span class="flex items-center gap-2 text-sm text-ink-gray-8">
              <span class="lucide-sun-moon size-4 text-ink-gray-6" aria-hidden="true" />
              {{ __("Theme") }}
            </span>
            <TabButtons
              :model-value="theme.savedMode.value"
              :options="themeOptions"
              :aria-label="__('Theme')"
              @update:model-value="setTheme"
            />
          </div>
          <SidebarItem :label="__('Log out')" icon="lucide-log-out" @click="logOut" />
        </nav>
      </div>

      <div
        v-if="legacyApps"
        class="col-start-1 row-start-1"
        :class="{ invisible: !appsOpen }"
        :inert="!appsOpen || undefined"
      >
        <div class="flex items-center gap-2 pb-2">
          <Button
            variant="ghost"
            icon="lucide-chevron-left"
            :aria-label="__('Back')"
            @click="appsOpen = false"
          />
          <span class="truncate text-lg font-semibold text-ink-gray-9">{{ __("Apps") }}</span>
        </div>
        <nav class="space-y-0.5" :aria-label="__('Apps')">
          <SidebarItem
            v-for="app in legacyAppLinks"
            :key="app.to"
            :label="app.label()"
            :icon="app.icon"
            @click="openApp(app.to)"
          />
        </nav>
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Avatar, BottomSheet, Button, SidebarItem, TabButtons } from "frappe-ui";
import { DialogTitle } from "reka-ui";
import { useRouter } from "vue-router";

import { useSession } from "@/platform/session";
import { useTheme, type ThemeMode } from "@/platform/theme";
import { translate as __ } from "@/platform/translation";
import { legacyAppLinks, showsLegacyApps } from "@/shell/accountMenu";
import { openSettings } from "@/shell/settings/useSettingsDialog";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const session = useSession();
const theme = useTheme();
const router = useRouter();
const legacyApps = showsLegacyApps();
const appsOpen = ref(false);

// Each open starts on the account view.
watch(
  () => props.open,
  (open) => {
    if (open) appsOpen.value = false;
  },
);
const user = computed(() => session.user.value);
const name = computed(() => user.value?.fullName || user.value?.id || __("Account"));
const email = computed(() => user.value?.email ?? null);

const themeOptions: { label: string; value: ThemeMode }[] = [
  { label: __("Light"), value: "light" },
  { label: __("Dark"), value: "dark" },
  { label: __("Auto"), value: "automatic" },
];

function setTheme(value: string | number) {
  const option = themeOptions.find((candidate) => candidate.value === value);
  if (option) void theme.set(option.value);
}

function showSettings() {
  emit("update:open", false);
  openSettings();
}

function openApp(to: string) {
  emit("update:open", false);
  void router.push(to);
}

function logOut() {
  void session.logout().then(() => window.location.reload());
}
</script>
