<template>
  <div
    class="w-full"
    @keydown.ctrl.enter.capture.stop="!disabled && !isEmpty && $emit('submit', editor)"
    @keydown.meta.enter.capture.stop="!disabled && !isEmpty && $emit('submit', editor)"
    @keydown.esc.stop="$emit('cancel', editor)"
  >
    <div class="flex" :class="editable && 'border rounded-4'">
      <Editor
        ref="textEditor"
        v-model="editorContent"
        :editable="editable"
        :extensions
        @change="
          (val) => {
            modelValue = val
            $emit('change')
          }
        "
      >
        <template #default="{ editor }">
          <EditorBubbleMenu :editor :items="bubbleItems" />
          <EditorTableMenu :editor />
          <EditorContent
            :editor
            class="min-w-2 flex-grow prose prose-sm prose-v3"
            :class="editable && 'pl-2.5 py-1.5'"
            :placeholder
            style="--editor-font-size: 14px"
          />
          <div v-if="editable" class="self-end me-1 flex-shrink-0 flex gap-1 mb-1.5">
            <Button
              v-if="!isEmpty"
              :disabled
              size="xs"
              variant="ghost"
              :icon="LucideMessageCircleReply"
              label="Send"
              tooltip="Send"
              @click="$emit('submit', editor)"
            />
            <Button
              v-if="!isEmpty"
              size="xs"
              variant="ghost"
              :icon="LucideX"
              label="Cancel"
              tooltip="Cancel"
              @click="$emit('cancel', editor)"
            />
          </div>
        </template>
      </Editor>
    </div>
  </div>
</template>

<script setup>
import LucideMessageCircleReply from '~icons/lucide/message-circle-reply'
import LucideX from '~icons/lucide/x'
import { Button } from 'frappe-ui'
import {
  Blockquote,
  Bold,
  Editor,
  EditorBubbleMenu,
  EditorContent,
  EditorTableMenu,
  InlineCode,
  InsertLink,
  Italic,
  RichTextKit,
  Separator,
  Strike,
} from 'frappe-ui/editor'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { useUsers } from '@/apps/writer/composables/useUsers'

import { BulletListItem, OrderedListItem } from './core-editor/menu-buttons'

const props = defineProps({
  placeholder: String,
  isEmpty: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false },
  editable: { type: Boolean, default: true },
  content: { type: String, default: '' },
})
defineEmits(['submit', 'cancel', 'change'])

const modelValue = defineModel({ type: String })
// Local ref mirrors the old v0 pattern: content prop sets initial display,
// modelValue (commentContents) is only updated when the user edits.
const editorContent = ref(props.content || '')

const textEditor = ref('textEditor')
const editor = computed(() => textEditor.value?.editor)

const focusWithoutScroll = () =>
  nextTick(() => editor.value?.commands.focus('end', { scrollIntoView: false }))

onMounted(() => {
  if (props.editable) focusWithoutScroll()
})

watch(
  () => props.editable,
  (editable) => {
    if (editable) focusWithoutScroll()
  },
)

const { users } = useUsers()
const extensions = [RichTextKit.configure({ mention: { items: () => users.value } })]

const bubbleItems = [
  Bold,
  Italic,
  Strike,
  Separator,
  InlineCode,
  Blockquote,
  Separator,
  { type: 'group', label: 'List', icon: 'lucide-list', items: [BulletListItem, OrderedListItem] },
]
</script>
