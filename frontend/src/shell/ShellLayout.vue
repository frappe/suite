<template>
  <GuestSurface v-if="showGuestSurface" />

  <template v-else-if="resolvedFrame === 'shell'">
    <DesktopShell
      v-if="!isMobile"
      :scroll="scrollOwner === 'shell'"
      class="h-full suite-area-shell"
    >
      <template #rail>
        <Rail :areas="areas" :badges="badges">
          <template #bell><slot name="bell" /></template>
        </Rail>
      </template>
      <template #sidebar>
        <AreaSidebarTarget />
      </template>
      <ContentPane :scroll="scrollOwner">
        <UnavailableSurface
          v-if="unavailable"
          :title="unavailable.title"
          :reason="unavailable.reason"
          :next-step="unavailable.nextStep"
        />
        <slot v-else />
      </ContentPane>
    </DesktopShell>

    <MobileShell
      v-else
      class="h-full"
      :class="{ 'suite-page-phone-chrome': pageOwnsPhoneChrome }"
    >
      <ContentPane :scroll="scrollOwner">
        <UnavailableSurface
          v-if="unavailable"
          :title="unavailable.title"
          :reason="unavailable.reason"
          :next-step="unavailable.nextStep"
        />
        <slot v-else />
      </ContentPane>
      <AccountSheet v-model:open="accountSheetOpen" />
      <template v-if="!pageOwnsPhoneChrome" #nav>
        <MobileNav
          :areas="areas"
          :active-area="activeArea?.id"
          @open-account="accountSheetOpen = true"
        />
      </template>
    </MobileShell>
  </template>

  <slot v-else-if="resolvedFrame === 'none'" />

  <SuiteSettingsDialog v-model:open="showSettings" v-model:tab="settingsTab" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { DesktopShell, MobileShell } from "frappe-ui";
import { useRoute } from "vue-router";

import { AreaSidebarTarget } from "@/platform/area-sidebar";
import type {
  AreaDefinition,
  PlatformCapability,
  ShellFrame,
  ScrollOwner,
} from "@/platform/contracts";
import { shellPhoneChromeRequested } from "@/platform/phone-chrome";
import { missingCapabilities, useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import AccountSheet from "@/shell/AccountSheet.vue";
import ContentPane from "@/shell/ContentPane.vue";
import GuestSurface from "@/shell/GuestSurface.vue";
import MobileNav from "@/shell/MobileNav.vue";
import Rail from "@/shell/Rail.vue";
import UnavailableSurface from "@/shell/UnavailableSurface.vue";
import { isMobile } from "@/shell/useIsMobile";
import { settingsTab, showSettings } from "@/shell/settings/useSettingsDialog";

const props = defineProps<{
  areas: readonly AreaDefinition[];
  allAreas: readonly AreaDefinition[];
  badges: Readonly<Record<string, number>>;
}>();

defineSlots<{ default?: () => unknown; bell?: () => unknown }>();

const route = useRoute();
const SuiteSettingsDialog = defineAsyncComponent(
  () => import("@/shell/settings/SuiteSettingsDialog.vue"),
);
const session = useSession();
const activeArea = computed(() =>
  props.allAreas.find((area) => area.id === route.meta.area),
);
const unavailable = computed(() => {
  const area = activeArea.value;
  if (!area || session.status.value !== "authenticated") return null;
  const missing = missingCapabilities(area.requires, session);
  return missing.length ? describeUnavailable(area, missing) : null;
});
const showGuestSurface = computed(
  () =>
    session.status.value === "guest" &&
    route.meta.allowGuest === true &&
    route.meta.frame !== "none" &&
    typeof route.meta.area === "string",
);
const resolvedFrame = computed<ShellFrame | null>(() => {
  if (showGuestSurface.value) return null;
  if (unavailable.value) return "shell";
  if (session.status.value === "guest" && route.meta.allowGuest !== true)
    return null;
  return route.meta.frame ?? "none";
});
const scrollOwner = computed<ScrollOwner>(() =>
  route.meta.scroll === "content" ? "content" : "shell",
);
// A page with its own phone chrome gets neither the bottom nav nor the top
// inset from the shell, so the inset applies once. The unavailable surface
// replaces that page and its chrome, so the shell draws its own again; so does
// a page that asks for it.
const pageOwnsPhoneChrome = computed(
  () =>
    route.meta.phoneChrome === "page" &&
    unavailable.value === null &&
    !shellPhoneChromeRequested.value,
);

const accountSheetOpen = ref(false);
// Close on navigation, and when the phone layout unmounts. Left open, the
// sheet reopens without input when the layout comes back to phone width.
watch([() => route.fullPath, isMobile], () => {
  accountSheetOpen.value = false;
});

function describeUnavailable(
  area: AreaDefinition,
  missing: readonly PlatformCapability[],
) {
  if (missing.includes("jmap")) {
    return {
      title: `${area.label()} ${__("is unavailable")}`,
      reason: __("This area needs a configured mail account."),
      nextStep: __(
        "Ask a site administrator to configure mail, then reload this page.",
      ),
    };
  }
  return {
    title: `${area.label()} ${__("is unavailable")}`,
    reason: __(
      "Your account does not have the capability required for this area.",
    ),
    nextStep: __("Ask a site administrator to review your access."),
  };
}
</script>

<style scoped>
/* frappe-ui's MobileShell pads its header target (its first child) by the top
   safe-area inset in an installed app. A page that owns its phone chrome
   applies that inset itself. */
.suite-page-phone-chrome > :deep(div:first-child) {
  padding-top: 0;
}

/* ScrollArea's content wrapper must stretch for short pages to fill the viewport. */
.suite-area-shell :deep([data-slot="desktop-shell-content"] > [data-slot="scroll-area"] > [data-slot="scroll-area-viewport"] > div) {
  display: flex;
  min-height: 100%;
  flex-direction: column;
}
</style>
