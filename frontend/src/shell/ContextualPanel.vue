<template>
  <component
    :is="Sidebar"
    v-if="!embedded"
    width="14rem"
    disable-collapse
  >
    <PanelBody :area="area" />
  </component>
  <PanelBody v-else :area="area" />
</template>

<script setup lang="ts">
import {
  defineComponent,
  h,
  shallowRef,
  watch,
  type Component,
  type PropType,
} from "vue";
import { ScrollArea, Sidebar } from "frappe-ui";

import type { AreaDefinition } from "@/platform/contracts";
import { translate as __ } from "@/platform/translation";

const props = withDefaults(
  defineProps<{ area: AreaDefinition; embedded?: boolean }>(),
  {
    embedded: false,
  },
);

const panel = shallowRef<Component | null>(null);
let loadId = 0;

watch(
  () => props.area,
  async (area) => {
    const current = ++loadId;
    panel.value = null;
    const loaded = await area.loadPanel();
    if (current === loadId) panel.value = loaded;
  },
  { immediate: true },
);

const PanelBody = defineComponent({
  name: "ContextualPanelBody",
  props: { area: { type: Object as PropType<AreaDefinition>, required: true } },
  setup() {
    return () =>
      h(
        ScrollArea,
        {
          class: "min-h-0 flex-1",
          viewportClass: "px-2 pt-2.5 pb-10",
          "aria-label": `${props.area.label()} ${__("navigation")}`,
        },
        {
          default: () =>
            panel.value
              ? h(panel.value)
              : h("div", { class: "space-y-2 px-2 py-1" }, [
                  h("div", {
                    class: "h-7 animate-pulse rounded-4 bg-surface-gray-2",
                  }),
                  h("div", {
                    class: "h-7 animate-pulse rounded-4 bg-surface-gray-2",
                  }),
                ]),
        },
      );
  },
});
</script>
