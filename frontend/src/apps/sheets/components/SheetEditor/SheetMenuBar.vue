<template>
  <!-- File, Edit, View, Insert, Format, Data: every action that has no button
  in the toolbar, labelled in words. Left and Right move between the menus. -->
  <nav class="sn-menubar" :aria-label="__('Spreadsheet menus')" @keydown="moveBetweenMenus">
    <Dropdown v-for="menu in shown" :key="menu.label" :options="menu.options" align="start">
      <template #default="{ open }">
        <Button
          class="sn-menubar-trigger"
          :variant="open ? 'subtle' : 'ghost'"
          size="sm"
          :label="menu.label"
          :data-menu="menu.label"
        />
      </template>
    </Dropdown>
  </nav>
</template>

<script setup lang="ts">
import { Button, Dropdown, type DropdownOptions } from 'frappe-ui'
import { computed } from 'vue'

import { translate as __ } from '@/platform/translation'

export type SheetMenu = { label: string; options: DropdownOptions }

const props = defineProps<{
  menus: SheetMenu[]
  /** Opens the surface's comments panel; the editor alone has none. */
  openComments?: (() => void) | null
}>()

const commentGroup = computed(() => ({
  group: 'Comment',
  hideLabel: true,
  options: [{ label: 'Comment', icon: 'lucide-messages-square', onClick: props.openComments! }],
}))

/** The editor's menus, plus Insert → Comment where the surface has comments. */
const shown = computed<SheetMenu[]>(() => {
  if (!props.openComments) return props.menus
  if (!props.menus.some((m) => m.label === 'Insert')) {
    const at = props.menus.findIndex((m) => m.label === 'View') + 1
    const menus = [...props.menus]
    menus.splice(at, 0, { label: 'Insert', options: [commentGroup.value] })
    return menus
  }
  return props.menus.map((m) =>
    m.label === 'Insert' ? { ...m, options: [...m.options, commentGroup.value] } : m,
  )
})

function moveBetweenMenus(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  const nav = event.currentTarget as HTMLElement
  const triggers = [...nav.querySelectorAll<HTMLElement>('[data-menu]')]
  const at = triggers.indexOf(event.target as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  const step = event.key === 'ArrowRight' ? 1 : -1
  triggers[(at + step + triggers.length) % triggers.length].focus()
}
</script>

<style scoped>
.sn-menubar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.sn-menubar-trigger {
  padding-inline: 8px;
  font-weight: 400;
  color: var(--ink-gray-8);
}
</style>
