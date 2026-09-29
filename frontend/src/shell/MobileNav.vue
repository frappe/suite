<template>
  <FrappeMobileNav>
    <FrappeMobileNavItem
      v-for="item in items"
      :key="item.id"
      :label="item.label"
      :route="item.opensSidebar ? undefined : item.to"
      :active="item.active"
      @click="item.opensSidebar && openAreaSidebar(item.id)"
    >
      <component
        :is="item.icon"
        class="size-6"
        :class="item.active ? 'text-ink-gray-8' : 'text-ink-gray-5'"
        aria-hidden="true"
      />
    </FrappeMobileNavItem>
    <FrappeMobileNavItem :label="__('Account')" @click="$emit('open-account')">
      <Avatar
        :image="session.user.value?.avatar ?? undefined"
        :label="accountLabel"
        size="md"
      />
    </FrappeMobileNavItem>
  </FrappeMobileNav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Avatar,
  MobileNav as FrappeMobileNav,
  MobileNavItem as FrappeMobileNavItem,
} from "frappe-ui";

import { hasAreaSidebar, openAreaSidebar } from "@/platform/area-sidebar";
import type { AreaDefinition } from "@/platform/contracts";
import { useSession } from "@/platform/session";
import { translate as __ } from "@/platform/translation";
import { deriveMobileNav } from "@/shell/mobileNav";

const props = defineProps<{
  areas: readonly AreaDefinition[];
  activeArea?: string;
}>();
defineEmits<{ "open-account": [] }>();

const session = useSession();
const accountLabel = computed(
  () => session.user.value?.fullName || session.user.value?.id || __("Account"),
);
const items = computed(() =>
  deriveMobileNav(props.areas, props.activeArea, hasAreaSidebar),
);
</script>
