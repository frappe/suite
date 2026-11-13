<template>
  <!-- File, Edit, View, Insert, Format, Data: every action that has no button
  in the toolbar, labelled in words. -->
  <nav class="sn-menubar" :aria-label="__('Spreadsheet menus')">
    <!-- A narrow header folds the six into one menu, each a submenu. A container
    query on the header swaps the two bars, so nothing moves on load. They are
    separate bars so the arrow keys never land on the hidden one. -->
    <MenubarRoot v-for="bar in bars" :key="bar.class" v-model="openMenu" loop :class="bar.class">
      <MenubarMenu v-for="menu in bar.menus" :key="menu.key" :value="menu.key">
        <MenubarTrigger as-child>
          <Button
            class="sn-menubar-trigger"
            variant="ghost"
            size="sm"
            :icon-left="menu.icon"
            :label="menu.label"
            :data-menu="menu.key"
          />
        </MenubarTrigger>
        <MenubarPortal :to="portalTarget">
          <MenubarContent
            data-slot="content"
            data-motion="instant"
            :class="menuClasses.content"
            align="start"
            :side-offset="4"
            :collision-padding="WINDOW_MARGIN"
          >
            <Menu
              :groups="normalizeMenuOptions(menu.options)"
              :close="closeMenu"
              :primitives="primitives"
            />
          </MenubarContent>
        </MenubarPortal>
      </MenubarMenu>
    </MenubarRoot>
  </nav>
</template>

<script setup lang="ts">
import { Button, usePortalTarget, type DropdownOptions } from 'frappe-ui'
import {
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRoot,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from 'reka-ui'
import { computed, h, ref, type FunctionalComponent } from 'vue'

import { translate as __ } from '@/platform/translation'

// The rows of every frappe-ui Dropdown, Writer's included. frappe-ui does not
// export them, and a copy of them would drift from Dropdown's look.
import Menu from '../../../../../../node_modules/frappe-ui/src/components/Menu/Menu.vue'
import {
  menuClasses,
  normalizeMenuOptions,
} from '../../../../../../node_modules/frappe-ui/src/components/Menu/utils'

export type SheetMenu = { key: string; label: string; icon?: string; options: DropdownOptions }

const props = defineProps<{
  menus: SheetMenu[]
  /** Opens the surface's comments panel; the editor alone has none. */
  openComments?: (() => void) | null
}>()

const commentGroup = computed(() => ({
  group: 'Comment',
  hideLabel: true,
  options: [{ label: __('Comment'), icon: 'lucide-messages-square', onClick: props.openComments! }],
}))

/** The editor's menus, plus Insert → Comment where the surface has comments. */
const shown = computed<SheetMenu[]>(() => {
  if (!props.openComments) return props.menus
  if (!props.menus.some((m) => m.key === 'insert')) {
    const at = props.menus.findIndex((m) => m.key === 'view') + 1
    const menus = [...props.menus]
    menus.splice(at, 0, { key: 'insert', label: __('Insert'), options: [commentGroup.value] })
    return menus
  }
  return props.menus.map((m) =>
    m.key === 'insert' ? { ...m, options: [...m.options, commentGroup.value] } : m,
  )
})

const folded = computed<DropdownOptions>(() =>
  shown.value.map((m) => ({ label: m.label, submenu: m.options })),
)

/** Each menu by its key; empty while they are all closed. One bar, one open menu. */
const openMenu = ref('')
const closeMenu = () => {
  openMenu.value = ''
}

const bars = computed(() => [
  { class: 'sn-menubar-wide', menus: shown.value },
  {
    class: 'sn-menubar-narrow',
    menus: [{ key: 'menu', label: __('Menu'), icon: 'lucide-menu', options: folded.value }],
  },
])

const portalTarget = usePortalTarget()

/** The room a panel leaves between itself and the edge of the window. */
const WINDOW_MARGIN = 8

// A panel's rows sit 6px inside it (p-1.5) and a submenu is placed from its row. So
// it moves up 6px to start level with that row, and out 8px to clear the panel by 2.
const SubContent: FunctionalComponent = (_, { attrs, slots }) =>
  h(
    MenubarSubContent,
    { ...attrs, 'side-offset': 8, alignOffset: -6, collisionPadding: WINDOW_MARGIN },
    slots,
  )

const primitives = {
  Item: MenubarItem,
  Label: MenubarLabel,
  Portal: MenubarPortal,
  Sub: MenubarSub,
  SubContent,
  SubTrigger: MenubarSubTrigger,
}
</script>

<style scoped>
.sn-menubar {
  flex-shrink: 0;
}
.sn-menubar-wide,
.sn-menubar-narrow {
  display: flex;
  align-items: center;
  gap: 2px;
}
.sn-menubar-trigger {
  padding-inline: 10px;
}
.sn-menubar-narrow {
  display: none;
}
/* The Drive header on /d/ (SheetsSurface.vue) is the `sn-topbar` container. */
@container sn-topbar (max-width: 640px) {
  .sn-menubar-wide {
    display: none;
  }
  .sn-menubar-narrow {
    display: flex;
  }
}
</style>
