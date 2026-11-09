<template>
  <!-- The toolbar's actions on the ticked threads: spelled out as icons, or folded into one menu
	     when the reading pane leaves the toolbar too little room. One with a menu of its own keeps its
	     button either way: a menu can't open from inside another one's row. -->
  <component :is="action.menu ?? Passthrough" v-for="action in buttons" :key="action.label">
    <Button
      :tooltip="action.label"
      variant="ghost"
      @click="action.menu ? undefined : action.onClick()"
    >
      <template #icon>
        <component :is="action.icon" class="icon" />
      </template>
    </Button>
  </component>
  <Dropdown v-if="collapsed" :options="actions.filter((action) => !action.menu)">
    <Button variant="ghost" :tooltip="__('Actions')">
      <template #icon>
        <Ellipsis class="icon" />
      </template>
    </Button>
  </Dropdown>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { Ellipsis } from 'lucide-vue-next'
import { computed, type FunctionalComponent } from 'vue'

import type { SelectAction } from '@/apps/mail/utils/selectActions'

const { actions, collapsed = false } = defineProps<{
  actions: SelectAction[]
  collapsed?: boolean
}>()

const buttons = computed(() =>
  actions.filter((action) => action.condition() && (!collapsed || action.menu)),
)

const Passthrough: FunctionalComponent = (_, { slots }) => slots.default?.()
</script>
