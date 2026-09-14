<template>
  <GuestSurface v-if="showGuestSurface" />

  <template v-else-if="resolvedFrame === 'area'">
    <DesktopShell
      v-if="!isMobile"
      :scroll="scrollOwner === 'shell'"
      class="h-full"
    >
      <template #rail>
        <Rail :areas="areas" :badges="badges">
          <template #bell><slot name="bell" /></template>
        </Rail>
      </template>
      <template v-if="activeArea && !unavailable" #sidebar>
        <ContextualPanel :area="activeArea" />
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

    <MobileShell v-else class="h-full">
      <ContentPane :scroll="scrollOwner">
        <UnavailableSurface
          v-if="unavailable"
          :title="unavailable.title"
          :reason="unavailable.reason"
          :next-step="unavailable.nextStep"
        />
        <slot v-else />
      </ContentPane>
      <MobileSheet
        v-if="activeArea && !unavailable"
        v-model:open="mobileSheetOpen"
        :title="activeArea.label()"
      >
        <ContextualPanel :area="activeArea" embedded />
        <div class="shrink-0 border-t border-outline-gray-1 p-2">
          <AccountMenu />
        </div>
      </MobileSheet>
      <template #nav>
        <MobileNav
          :areas="areas"
          :active-area="activeArea?.id"
          @open-sheet="mobileSheetOpen = true"
        />
      </template>
    </MobileShell>
  </template>

  <template v-else-if="resolvedFrame === 'document'">
    <DesktopShell v-if="!isMobile" :scroll="false" class="h-full">
      <template #rail>
        <Rail :areas="areas" :badges="badges">
          <template #bell><slot name="bell" /></template>
        </Rail>
      </template>
      <DocumentFrame><slot /></DocumentFrame>
    </DesktopShell>
    <MobileShell v-else class="h-full">
      <DocumentFrame><slot /></DocumentFrame>
      <template #nav>
        <MobileNav
          :areas="areas"
          :active-area="activeArea?.id"
          @open-sheet="mobileSheetOpen = true"
        />
      </template>
    </MobileShell>
  </template>

  <slot v-else-if="resolvedFrame === 'none'" />

  <SuiteSettingsDialog v-if="showSettings" />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from "vue";
import { DesktopShell, MobileShell } from "frappe-ui";
import { useRoute } from "vue-router";

import type {
  AreaDefinition,
  PlatformCapability,
  ShellFrame,
  ScrollOwner,
} from "@/platform/contracts";
import { missingCapabilities, useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import AccountMenu from "@/shell/AccountMenu.vue";
import ContentPane from "@/shell/ContentPane.vue";
import ContextualPanel from "@/shell/ContextualPanel.vue";
import DocumentFrame from "@/shell/DocumentFrame.vue";
import GuestSurface from "@/shell/GuestSurface.vue";
import MobileNav from "@/shell/MobileNav.vue";
import MobileSheet from "@/shell/MobileSheet.vue";
import Rail from "@/shell/Rail.vue";
import UnavailableSurface from "@/shell/UnavailableSurface.vue";
import { isMobile } from "@/shell/useIsMobile";
import { mobileSheetOpen } from "@/shell/useMobileSheet";
import { showSettings } from "@/shell/settings/useSettingsDialog";

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
  if (unavailable.value) return "area";
  if (session.status.value === "guest" && route.meta.allowGuest !== true)
    return null;
  return (route.meta.frame as ShellFrame | undefined) ?? "none";
});
const scrollOwner = computed<ScrollOwner>(() =>
  route.meta.scroll === "content" ? "content" : "shell",
);

// Products ask for their contextual panel on mobile with a window event.
// This keeps the products -> platform import direction (no shell import).
const OPEN_PANEL_EVENT = "suite:open-active-area-panel";
function onOpenActiveAreaPanel(event: Event) {
  const area = (event as CustomEvent<{ area?: string }>).detail?.area;
  if (!isMobile.value) return;
  if (area && area !== route.meta.area) return;
  mobileSheetOpen.value = true;
}
onMounted(() => window.addEventListener(OPEN_PANEL_EVENT, onOpenActiveAreaPanel));
onBeforeUnmount(() =>
  window.removeEventListener(OPEN_PANEL_EVENT, onOpenActiveAreaPanel),
);

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
