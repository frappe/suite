<template>
  <BubbleMenu
    :editor
    :plugin-key="SELECTION_MENU"
    :should-show
    :options="{ placement: 'top', offset: 8 }"
    class="z-20"
    data-slot="bubble-menu"
  >
    <div
      ref="bar"
      class="flex h-7 items-center gap-0.5 rounded-5 bg-surface-elevation-2 p-0.5 shadow-md"
      role="toolbar"
      :aria-label="__('Selection')"
      @focusin="returnFocus"
    >
      <Dropdown :options="blockOptions" :offset="8" :portal-to="bar ?? undefined">
        <ToolbarButton compact :label="__('Text style')">
          <span class="whitespace-nowrap text-sm leading-[15px]">{{ __(activeBlock.label) }}</span>
          <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
        </ToolbarButton>
      </Dropdown>

      <ToolbarButton
        v-for="mark in MARKS"
        :key="mark.name"
        compact
        :icon="mark.icon"
        :label="__(mark.label)"
        :shortcut="mark.shortcut"
        :pressed="isActive(mark.name)"
        @click="mark.toggle(chain()).run()"
      />
      <ToolbarButton
        compact
        icon="lucide-link"
        :label="__('Link')"
        shortcut="Mod-k"
        :pressed="isActive('link')"
        @click="editor.commands.openLinkEditor()"
      />
      <Popover side="bottom" align="start" :offset="8" bare :portal-to="bar ?? undefined">
        <template #trigger>
          <ToolbarButton compact icon="lucide-baseline" :label="__('Color')" :pressed="hasColor" />
        </template>
        <template #default="{ close }">
          <ColorPanel :editor @pick="close" />
        </template>
      </Popover>
      <ToolbarButton
        compact
        icon="lucide-highlighter"
        :label="__('Highlight')"
        shortcut="Mod-Shift-h"
        :pressed="isActive('namedHighlight')"
        @click="toggleHighlight(editor)"
      />

      <span class="writer-divider h-4" aria-hidden="true" />

      <ToolbarButton
        compact
        class="text-sm"
        :label="__('Comment')"
        shortcut="Mod-Alt-m"
        @click="emit('comment')"
      >
        <span class="lucide-message-square-plus size-3.5" aria-hidden="true" />
        {{ __('Comment') }}
      </ToolbarButton>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { Dropdown, Popover, type DropdownOptions } from 'frappe-ui'
import { computed, toRef, useTemplateRef } from 'vue'

import { SELECTION_MENU } from '@/apps/writer/extensions/link-editing'
import { translate as __ } from '@/platform/translation'

import ColorPanel from './ColorPanel.vue'
import { activeBlockStyle, BLOCK_STYLES, MARKS, toggleHighlight } from './formatting'
import ToolbarButton from './ToolbarButton.vue'
import { useEditorVersion } from './useEditorVersion'
import { useReturnFocus } from './useReturnFocus'

type ShouldShow = InstanceType<typeof BubbleMenu>['$props']['shouldShow']

const props = defineProps<{ editor: Editor; shouldShow: ShouldShow }>()
const emit = defineEmits<{ comment: [] }>()

// Menus open inside the bar, so the editor does not read their focus as a blur and hide it
const bar = useTemplateRef<HTMLElement>('bar')

const returnFocus = useReturnFocus(() => props.editor)
const version = useEditorVersion(toRef(props, 'editor'))

const chain = () => props.editor.chain().focus()
const isActive = (name: string) => {
  void version.value
  return props.editor.isActive(name)
}

const activeBlock = computed(() => {
  void version.value
  return activeBlockStyle(props.editor)
})
const hasColor = computed(() => {
  void version.value
  return !!props.editor.getAttributes('textStyle').color
})

const blockOptions = computed((): DropdownOptions => {
  void version.value
  return BLOCK_STYLES.map((style) => ({
    label: __(style.label),
    icon: style.icon,
    selected: style === activeBlock.value,
    onClick: () => style.apply(chain()).run(),
  }))
})
</script>
