<template>
  <BubbleMenu
    :editor
    :plugin-key="LINK_POPOVER"
    :should-show
    :get-referenced-virtual-element
    :options="{ placement: 'bottom-start', offset: 6 }"
    class="z-20"
    data-slot="link-popover"
    @focusout="onFocusOut"
    @keydown.esc.stop.prevent="close"
  >
    <!-- Forked from frappe-ui's editor/extensions/link/LinkEditorPopup.vue -->
    <div
      class="flex min-w-60 max-w-80 items-center gap-0.5 rounded-5 border border-outline-gray-2 bg-surface-elevation-2 p-1 shadow-lg"
      role="dialog"
      :aria-label="__('Link')"
    >
      <form v-if="editing" class="flex flex-1 items-center gap-0.5" @submit.prevent="apply">
        <TextInput
          ref="input"
          v-model="draft"
          class="flex-1"
          size="sm"
          :placeholder="__('Paste or type a link')"
          :aria-label="__('Link address')"
          :aria-invalid="invalid"
          @update:model-value="invalid = false"
        />
        <ToolbarButton compact icon="lucide-check" :label="__('Apply')" type="submit" />
      </form>
      <template v-else>
        <span class="lucide-globe ms-1 size-3.5 shrink-0 text-ink-gray-5" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate px-1 text-sm text-ink-gray-8" :title="href">
          {{ href }}
        </span>
        <ToolbarButton compact icon="lucide-external-link" :label="__('Open')" @click="openLink" />
        <ToolbarButton
          compact
          icon="lucide-pencil"
          :label="__('Edit')"
          shortcut="Mod-k"
          @click="editor.commands.openLinkEditor()"
        />
        <ToolbarButton
          compact
          icon="lucide-link-2-off"
          :label="__('Remove link')"
          @click="removeLink(editor)"
        />
      </template>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import { posToDOMRect, type Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { TextInput } from 'frappe-ui'
import { computed, nextTick, ref, toRef, useTemplateRef, watch } from 'vue'

import {
  applyLink,
  isEditingLink,
  LINK_POPOVER,
  linkRange,
  normalizeHref,
  removeLink,
} from '@/apps/writer/extensions/link-editing'
import { translate as __ } from '@/platform/translation'

import ToolbarButton from './ToolbarButton.vue'
import { useEditorVersion } from './useEditorVersion'

type ShouldShow = InstanceType<typeof BubbleMenu>['$props']['shouldShow']

const props = defineProps<{ editor: Editor }>()

const version = useEditorVersion(toRef(props, 'editor'))
const editing = computed(() => {
  void version.value
  return isEditingLink(props.editor.state)
})
const href = computed((): string => {
  void version.value
  return props.editor.getAttributes('link').href ?? ''
})

const shouldShow: ShouldShow = ({ editor, state, view }) =>
  editor.isEditable &&
  (isEditingLink(state) || (state.selection.empty && view.hasFocus() && editor.isActive('link')))

function getReferencedVirtualElement() {
  const { view, state } = props.editor
  const range = linkRange(state) ?? state.selection
  const rect = posToDOMRect(view, range.from, range.to)
  return { getBoundingClientRect: () => rect, getClientRects: () => [rect] }
}

const draft = ref('')
const invalid = ref(false)
const input = useTemplateRef<InstanceType<typeof TextInput>>('input')

watch(editing, async (isEditing) => {
  if (!isEditing) return
  draft.value = href.value
  invalid.value = false
  await nextTick()
  const element = input.value?.inputElement
  element?.focus({ preventScroll: true })
  element?.select()
})

function apply() {
  const next = normalizeHref(draft.value)
  if (!draft.value.trim() && href.value) removeLink(props.editor)
  else if (next) applyLink(props.editor, next)
  else invalid.value = true
}

function close() {
  if (props.editor.commands.closeLinkEditor()) props.editor.commands.focus()
}

function openLink() {
  window.open(href.value, '_blank', 'noopener,noreferrer')
}

// Focus that leaves for somewhere other than the editor ends editing. Checked after the popover
// re-renders, as a pressed Edit button leaves the page as the input takes focus.
function onFocusOut(event: FocusEvent) {
  const popover = event.currentTarget as HTMLElement
  setTimeout(() => {
    const focused = document.activeElement
    if (focused && (popover.contains(focused) || props.editor.view.dom.contains(focused))) return
    props.editor.commands.closeLinkEditor()
  })
}
</script>
