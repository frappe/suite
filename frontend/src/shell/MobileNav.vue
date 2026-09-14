<template>
  <FrappeMobileNav>
    <FrappeMobileNavItem
      v-for="item in items"
      :key="item.id"
      :label="item.label"
      :to="item.to"
      :active="activeArea === item.id"
    >
      <component :is="item.icon" class="size-5" aria-hidden="true" />
    </FrappeMobileNavItem>
    <FrappeMobileNavItem :label="__('More')" @click="$emit('open-sheet')">
      <span class="lucide-ellipsis size-5" aria-hidden="true" />
    </FrappeMobileNavItem>
  </FrappeMobileNav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  MobileNav as FrappeMobileNav,
  MobileNavItem as FrappeMobileNavItem,
} from "frappe-ui";

import type { AreaDefinition } from "@/platform/contracts";
import { deriveMobileNav } from "@/shell/mobileNav";

const props = defineProps<{
  areas: readonly AreaDefinition[];
  activeArea?: string;
}>();
defineEmits<{ "open-sheet": [] }>();

const items = computed(() => deriveMobileNav(props.areas));
</script>
