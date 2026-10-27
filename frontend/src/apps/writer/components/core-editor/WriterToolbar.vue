<template>
  <div
    class="flex shrink-0 items-start border-b border-outline-gray-1 px-3"
    role="toolbar"
    :aria-label="__('Formatting')"
    @focusin="returnFocus"
  >
    <!-- Groups that do not fit wrap onto rows that More shows -->
    <div
      ref="rows"
      class="relative flex min-w-0 flex-1 flex-wrap gap-x-0.5 overflow-hidden"
      :class="!expanded && 'h-9'"
    >
      <div class="writer-toolbar-group">
        <ToolbarButton
          icon="lucide-undo-2"
          :label="__('Undo')"
          shortcut="Mod-z"
          :disabled="!canUndo"
          @click="chain().undo().run()"
        />
        <ToolbarButton
          icon="lucide-redo-2"
          :label="__('Redo')"
          shortcut="Mod-Shift-z"
          :disabled="!canRedo"
          @click="chain().redo().run()"
        />
        <span class="writer-divider" aria-hidden="true" />
        <Dropdown :options="insertOptions">
          <ToolbarButton :label="__('Insert')">
            <span class="lucide-plus size-4" aria-hidden="true" />
            <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
          </ToolbarButton>
        </Dropdown>
      </div>

      <div class="writer-toolbar-group">
        <Dropdown :options="blockOptions">
          <ToolbarButton :label="__('Text style')">
            <!-- Every name in one cell, so the select keeps the width of the longest. The whole-pixel
               minimum keeps the controls after it on whole pixels, so their icons stay sharp -->
            <span class="grid min-w-[96px] justify-items-start text-base leading-4">
              <span
                v-for="style in BLOCK_STYLES"
                :key="style.value"
                class="[grid-area:1/1]"
                :class="style !== activeBlock && 'invisible'"
                :aria-hidden="style !== activeBlock"
                >{{ __(style.label) }}</span
              >
            </span>
            <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
          </ToolbarButton>
        </Dropdown>
      </div>

      <div class="writer-toolbar-group">
        <Dropdown :options="fontOptions">
          <ToolbarButton :label="__('Font')">
            <span class="grid min-w-[108px] justify-items-start text-base leading-4">
              <span
                v-for="font in FONT_FAMILIES"
                :key="font.key"
                class="[grid-area:1/1] whitespace-nowrap"
                :class="font.key !== activeFont && 'invisible'"
                :aria-hidden="font.key !== activeFont"
                >{{ font.label }}</span
              >
            </span>
            <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
          </ToolbarButton>
        </Dropdown>
      </div>

      <div class="writer-toolbar-group" role="group" :aria-label="__('Font size')">
        <ToolbarButton
          icon="lucide-minus"
          :label="__('Smaller text')"
          :disabled="fontSize <= FONT_SIZE_MIN"
          @click="stepFontSize(editor, -1)"
        />
        <span class="w-6 text-center text-base leading-4 tabular-nums text-ink-gray-7">
          {{ fontSize }}
        </span>
        <ToolbarButton
          icon="lucide-plus"
          :label="__('Larger text')"
          :disabled="fontSize >= FONT_SIZE_MAX"
          @click="stepFontSize(editor, 1)"
        />
      </div>

      <div class="writer-toolbar-group">
        <ToolbarButton
          v-for="mark in MARKS"
          :key="mark.name"
          :icon="mark.icon"
          :label="__(mark.label)"
          :shortcut="mark.shortcut"
          :pressed="isActive(mark.name)"
          @click="mark.toggle(chain()).run()"
        />

        <Popover side="bottom" align="start" :offset="6" bare>
          <template #trigger>
            <ToolbarButton :label="__('Color')">
              <span class="lucide-baseline size-4" aria-hidden="true" />
              <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
            </ToolbarButton>
          </template>
          <template #default="{ close }">
            <ColorPanel :editor @pick="close" />
          </template>
        </Popover>
      </div>

      <div class="writer-toolbar-group">
        <span class="writer-divider" aria-hidden="true" />
        <ToolbarButton
          icon="lucide-code"
          :label="__('Inline code')"
          shortcut="Mod-e"
          :pressed="isActive('code')"
          @click="chain().toggleCode().run()"
        />
        <ToolbarButton
          icon="lucide-quote"
          :label="__('Quote')"
          shortcut="Mod-Shift-b"
          :pressed="isActive('blockquote')"
          @click="chain().toggleBlockquote().run()"
        />
        <ToolbarButton
          icon="lucide-minus"
          :label="__('Divider')"
          @click="chain().setHorizontalRule().run()"
        />
      </div>

      <div class="writer-toolbar-group">
        <span class="writer-divider" aria-hidden="true" />
        <Dropdown :options="listOptions">
          <ToolbarButton :label="__('Lists')">
            <span :class="activeList.icon" class="size-4" aria-hidden="true" />
            <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
          </ToolbarButton>
        </Dropdown>
        <Dropdown :options="alignOptions">
          <ToolbarButton :label="__('Alignment')">
            <span :class="activeAlign.icon" class="size-4" aria-hidden="true" />
            <span class="lucide-chevron-down size-3.5" aria-hidden="true" />
          </ToolbarButton>
        </Dropdown>
        <SpacingDialog :editor :settings="settings ?? undefined" />
        <ToolbarButton
          icon="lucide-indent-decrease"
          :label="__('Outdent')"
          shortcut="Shift-Tab"
          :disabled="!canLift"
          @click="chain().liftListItem(listItemType).run()"
        />
        <ToolbarButton
          icon="lucide-indent-increase"
          :label="__('Indent')"
          shortcut="Tab"
          :disabled="!canSink"
          @click="chain().sinkListItem(listItemType).run()"
        />
      </div>

      <div class="writer-toolbar-group">
        <span class="writer-divider" aria-hidden="true" />
        <ToolbarButton
          icon="lucide-link"
          :label="__('Link')"
          shortcut="Mod-k"
          :pressed="isActive('link')"
          @click="editor.commands.openLinkEditor()"
        />
        <TableToolbarButton :editor />
        <ToolbarButton
          icon="lucide-highlighter"
          :label="__('Highlight')"
          shortcut="Mod-Shift-h"
          :pressed="isActive('namedHighlight')"
          @click="toggleHighlight(editor)"
        />
      </div>

      <div class="writer-toolbar-group">
        <span class="writer-divider" aria-hidden="true" />
        <ToolbarButton
          icon="lucide-paint-roller"
          :label="__('Paint styles')"
          :description="__('Copy the formatting here to the next text you select')"
          :pressed="isPainting"
          @click="togglePainting(editor)"
        />
        <ToolbarButton
          icon="lucide-remove-formatting"
          :label="__('Clear formatting')"
          @click="clearFormatting"
        />
      </div>
    </div>

    <div v-if="overflows" class="writer-toolbar-group">
      <ToolbarButton
        icon="lucide-ellipsis"
        :label="__('More formatting')"
        :pressed="expanded"
        @click="expanded = !expanded"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import { useResizeObserver } from '@vueuse/core'
import { Dropdown, Popover, type DropdownOptions } from 'frappe-ui'
import { computed, defineAsyncComponent, h, ref, toRef, useTemplateRef, watch } from 'vue'

import { FONT_FAMILIES } from '@/apps/writer/utils'
import type { LayoutSettings } from '@/apps/writer/utils/editor-layout'
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from '@/apps/writer/utils/typography'
import { translate as __ } from '@/platform/translation'

import ColorPanel from './ColorPanel.vue'
import { selectionFontSize, stepFontSize } from './fontSize'
import {
  activeBlockStyle,
  BLOCK_STYLES,
  MARKS,
  toggleHighlight,
  type BlockStyle,
} from './formatting'
import { INSERTS } from './inserts'
import { togglePainting, watchPaintTarget } from './paintStyles'
import TableToolbarButton from './table/TableToolbarButton.vue'
import ToolbarButton from './ToolbarButton.vue'
import { useEditorVersion } from './useEditorVersion'
import { useReturnFocus } from './useReturnFocus'

const SpacingDialog = defineAsyncComponent(
  () => import('@/apps/writer/components/SpacingDialog.vue'),
)

const props = defineProps<{
  editor: Editor
  settings: LayoutSettings
  isPainting: boolean
}>()

const LISTS = BLOCK_STYLES.filter((style) =>
  ['bulletList', 'orderedList', 'taskList'].includes(style.value),
)

const ALIGNMENTS = [
  { value: 'left', label: 'Align left', icon: 'lucide-align-left' },
  { value: 'center', label: 'Align center', icon: 'lucide-align-center' },
  { value: 'right', label: 'Align right', icon: 'lucide-align-right' },
  { value: 'justify', label: 'Justify', icon: 'lucide-align-justify' },
] as const

const version = useEditorVersion(toRef(props, 'editor'))

/** Reads editor state again after every transaction. */
function live<T>(read: () => T) {
  return computed(() => {
    void version.value
    return read()
  })
}

const chain = () => props.editor.chain().focus()
const isActive = (name: string) => {
  void version.value
  return props.editor.isActive(name)
}

const activeBlock = live(() => activeBlockStyle(props.editor))
const activeList = live(() => LISTS.find((list) => list.isActive(props.editor)) ?? LISTS[1])
const activeAlign = live(
  () =>
    ALIGNMENTS.find((align) => props.editor.isActive({ textAlign: align.value })) ?? ALIGNMENTS[0],
)
const listItemType = live(() => (props.editor.isActive('taskItem') ? 'taskItem' : 'listItem'))
const canSink = live(() => props.editor.can().sinkListItem(listItemType.value))
const canLift = live(() => props.editor.can().liftListItem(listItemType.value))

const defaultFont = computed(() => props.settings?.font_family || 'inter')
const activeFont = live(
  () => FONT_FAMILIES.find((font) => font.isActive(props.editor))?.key ?? defaultFont.value,
)

const fontSize = live(() => selectionFontSize(props.editor))
const canUndo = live(() => props.editor.can().undo())
const canRedo = live(() => props.editor.can().redo())

watch(
  () => props.editor,
  (editor, _previous, onCleanup) => onCleanup(watchPaintTarget(editor)),
  { immediate: true },
)

function styleOption(style: BlockStyle) {
  return {
    label: __(style.label),
    icon: style.icon,
    selected: style.isActive(props.editor),
    onClick: () => style.apply(chain()).run(),
  }
}

const blockOptions = live((): DropdownOptions => BLOCK_STYLES.map(styleOption))
const listOptions = live((): DropdownOptions => LISTS.map(styleOption))

const alignOptions = live((): DropdownOptions =>
  ALIGNMENTS.map((align) => ({
    label: __(align.label),
    icon: align.icon,
    selected: align === activeAlign.value,
    onClick: () => chain().setTextAlign(align.value).run(),
  })),
)

const fontOptions = live((): DropdownOptions =>
  FONT_FAMILIES.map((font) => ({
    label: font.label,
    selected: font.key === activeFont.value,
    onClick: () =>
      font.key === defaultFont.value ? chain().unsetFontFamily().run() : font.action(props.editor),
    slots: {
      label: () =>
        h(
          'span',
          { class: 'block leading-4', style: { fontFamily: `var(--font-${font.key})` } },
          font.label,
        ),
    },
  })),
)

const insertOptions = live((): DropdownOptions =>
  (['Media', 'Blocks'] as const).map((group) => ({
    group: __(group),
    options: INSERTS.filter((insert) => insert.group === group).map((insert) => ({
      label: __(insert.label),
      icon: insert.icon,
      condition: () => insert.isAvailable(props.editor),
      onClick: () => insert.insert(props.editor),
    })),
  })),
)

function clearFormatting() {
  props.editor.commands.focus()
  props.editor.commands.clearStyles()
  props.editor.commands.cleanStyles()
}

const returnFocus = useReturnFocus(() => props.editor)

const rows = useTemplateRef<HTMLElement>('rows')
const expanded = ref(false)
const overflows = ref(false)

// Runs again when More appears or the rows expand, as both resize the rows
useResizeObserver(rows, layOutRows)

/** Marks the groups that start a row, and makes the hidden rows unreachable. */
function layOutRows() {
  const groups = [...(rows.value?.children ?? [])] as HTMLElement[]
  const firstRowTop = groups[0]?.offsetTop ?? 0
  overflows.value = groups.some((group) => group.offsetTop > firstRowTop)
  if (!overflows.value) expanded.value = false
  groups.forEach((group, index) => {
    const previous = groups[index - 1]
    group.toggleAttribute('data-row-start', !!previous && group.offsetTop > previous.offsetTop)
    group.inert = !expanded.value && group.offsetTop > firstRowTop
  })
}
</script>
