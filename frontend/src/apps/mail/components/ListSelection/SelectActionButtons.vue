<template>
  <!-- The toolbar's actions on the ticked threads, in the thread toolbar's groups with a line between
       those that show (see ThreadHeader): what is done to them, where they are filed, what holds them
       for later, then what only a selection offers. Folded into one menu, in the same order, where the
       reading pane leaves the toolbar too little room; the filing menus keep their buttons, and the
       menu stands where the later group would. Folded, one with a menu of its own asks as a submenu
       where it has one, or reads "…" and asks in its dialog. -->
  <div class="flex items-center gap-2">
    <template v-for="(group, index) in groups" :key="group.key">
      <Divider v-if="index" v-bind="GROUP_LINE" />
      <div class="flex items-center space-x-2">
        <template v-if="group.key === 'filing'">
          <!-- Folders, the thread toolbar's menu of ticks, for every ticked thread at once: stays
               open, to file them in several. -->
          <Dropdown v-for="menu in filing" :key="menu.label" :options="menu.options">
            <Button variant="ghost" :tooltip="menu.label" :aria-label="menu.label">
              <template #icon>
                <component :is="menu.icon" class="icon" />
              </template>
            </Button>
          </Dropdown>
        </template>
        <Dropdown v-else-if="group.key === 'folded'" v-model:open="foldedOpen" :options="folded">
          <Button variant="ghost" :tooltip="__('Actions')" :aria-label="__('Actions')">
            <template #icon>
              <Ellipsis class="icon" />
            </template>
          </Button>
        </Dropdown>
        <template v-else>
          <component
            :is="action.menu ?? Passthrough"
            v-for="action in group.actions"
            :key="action.label"
          >
            <Button
              :tooltip="action.label"
              :aria-label="action.label"
              variant="ghost"
              @click="action.menu ? undefined : action.onClick()"
            >
              <template #icon>
                <component :is="action.icon" class="icon" />
              </template>
            </Button>
          </component>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { Button, Divider, Dropdown } from 'frappe-ui'
import { Ellipsis } from 'lucide-vue-next'
import { computed, ref, type FunctionalComponent } from 'vue'

import type { FilingMenu, SelectAction } from '@/apps/mail/utils/selectActions'
import { GROUP_LINE } from '@/apps/mail/utils/toolbarGroups'

const {
  actions,
  filing = [],
  collapsed = false,
} = defineProps<{
  actions: SelectAction[]
  // Where the ticked threads are filed (Move To, Folders), where the list files them.
  filing?: FilingMenu[]
  collapsed?: boolean
}>()

const ACTION_GROUPS = ['act', 'later', 'selection'] as const
const shownIn = (key: SelectAction['group']) =>
  actions.filter((action) => action.group === key && action.condition())

type Group = { key: SelectAction['group'] | 'filing' | 'folded'; actions: SelectAction[] }
const groups = computed(() => {
  const filingGroup: Group = { key: 'filing', actions: [] }
  const all: Group[] = collapsed
    ? [filingGroup, { key: 'folded', actions: actions.filter((action) => action.condition()) }]
    : [
        { key: 'act', actions: shownIn('act') },
        filingGroup,
        { key: 'later', actions: shownIn('later') },
        { key: 'selection', actions: shownIn('selection') },
      ]
  return all.filter((group) => (group.key === 'filing' ? filing.length : group.actions.length))
})

const foldedOpen = ref(false)
const foldedItem = ({ label, icon, onClick, menu, submenu }: SelectAction) =>
  submenu
    ? { label, icon, submenu: foldedOpen.value ? submenu() : [] }
    : { label: menu ? __('{0}…', [label]) : label, icon, onClick }
// A group of the menu's own for each of the toolbar's, a line between them.
const folded = computed(() =>
  ACTION_GROUPS.flatMap((key) => {
    const shown = shownIn(key)
    return shown.length ? [{ group: '', hideLabel: true, options: shown.map(foldedItem) }] : []
  }),
)

const Passthrough: FunctionalComponent = (_, { slots }) => slots.default?.()
</script>
