<template>
  <!-- The toolbar's actions on the ticked threads: spelled out as icons, or folded into one menu
	     when the reading pane leaves the toolbar too little room. -->
  <Dropdown v-if="collapsed" :options="actions">
    <Button variant="ghost" :tooltip="__('Actions')">
      <template #icon>
        <Ellipsis class="icon" />
      </template>
    </Button>
  </Dropdown>
  <template v-else>
    <Button
      v-for="action in actions.filter((a) => a.condition())"
      :key="action.label"
      :tooltip="action.label"
      variant="ghost"
      @click="action.onClick"
    >
      <template #icon>
        <component :is="action.icon" class="icon" />
      </template>
    </Button>
  </template>
</template>

<script setup lang="ts">
import { Button, Dropdown } from 'frappe-ui'
import { Ellipsis } from 'lucide-vue-next'

import type { SelectAction } from '@/apps/mail/utils/selectActions'

const { actions, collapsed = false } = defineProps<{
  actions: SelectAction[]
  collapsed?: boolean
}>()
</script>
