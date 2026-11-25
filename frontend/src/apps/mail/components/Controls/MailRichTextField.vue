<template>
  <!-- Typing, selecting and scrolling here is the field's own, so a sheet it sits in does not take a swipe on it for a close -->
  <div class="w-full" data-no-sheet-drag>
    <Editor
      :model-value="html"
      :extensions
      :editable="isWritable"
      :placeholder
      :upload-function="uploadPrivateFile"
      @change="onChange"
    >
      <div
        v-if="editable"
        class="border-outline-elevation-2 w-full overflow-x-auto rounded-t-6 border p-1"
        :class="toolbarFill"
      >
        <EditorFixedMenu :items="tools" />
      </div>
      <EditorContent
        class="prose-sm border-outline-gray-2 min-h-32 max-w-none border p-2"
        :class="[boxShape, boxFill]"
      />
    </Editor>
  </div>
</template>

<script setup lang="ts">
import { Editor, EditorContent, EditorFixedMenu, type MenuItem } from 'frappe-ui/editor'
import { computed } from 'vue'

import { useEditorMenu } from '@/apps/mail/utils/editorMenu'
import { mailEditorKit, uploadPrivateFile } from '@/apps/mail/utils/text-editor'

// The rich-text box of Mail's settings: a signature, or the vacation message.
const html = defineModel<string>({ default: '' })
const {
  placeholder,
  editable = true,
  disabled = false,
  divParagraphs = true,
} = defineProps<{
  placeholder?: string
  editable?: boolean
  // Shown as a field that is switched off: the box keeps its shape, with every tool off
  disabled?: boolean
  divParagraphs?: boolean
}>()

const extensions = mailEditorKit({ divParagraphs })
const menu = useEditorMenu()
const isWritable = computed(() => editable && !disabled)
// Disabled, the box takes the fill and ink of a disabled frappe-ui input
const toolbarFill = computed(() => (disabled ? 'bg-surface-gray-1' : 'bg-surface-base'))
const boxFill = computed(() => (disabled ? 'bg-surface-gray-1 text-ink-gray-5' : ''))
const boxShape = computed(() => (editable ? 'rounded-b-6 border-t-0' : 'rounded-4'))
/** The tool as a plain button that is switched off. */
function switchedOff(item: MenuItem): MenuItem {
  if ('type' in item) {
    return item
  }

  return { ...item, component: undefined, isDisabled: () => true }
}

const tools = computed(() => {
  if (disabled) {
    return menu.value.map(switchedOff)
  }

  return menu.value
})

const onChange = (value: unknown) => {
  if (typeof value === 'string') html.value = value
}
</script>
