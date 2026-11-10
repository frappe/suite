<template>
  <div class="w-full">
    <Editor
      :model-value="html"
      :extensions
      :editable
      :placeholder
      :upload-function="uploadPrivateFile"
      @change="onChange"
    >
      <div
        v-if="editable"
        class="border-outline-elevation-2 bg-surface-base w-full overflow-x-auto rounded-t-6 border p-1"
      >
        <EditorFixedMenu :items="menu" />
      </div>
      <EditorContent
        class="prose-sm border-outline-gray-2 min-h-[8rem] max-w-none border p-2"
        :class="editable ? 'rounded-b-6 border-t-0' : 'rounded-4'"
      />
    </Editor>
  </div>
</template>

<script setup lang="ts">
import { Editor, EditorContent, EditorFixedMenu } from 'frappe-ui/editor'

import { useEditorMenu } from '@/apps/mail/utils/editorMenu'
import { mailEditorKit, uploadPrivateFile } from '@/apps/mail/utils/text-editor'

// The rich-text box of Mail's settings: a signature, or the vacation message.
const html = defineModel<string>({ default: '' })
const {
  placeholder,
  editable = true,
  divParagraphs = true,
} = defineProps<{
  placeholder?: string
  editable?: boolean
  divParagraphs?: boolean
}>()

const extensions = mailEditorKit({ divParagraphs })
const menu = useEditorMenu()

const onChange = (value: unknown) => {
  if (typeof value === 'string') html.value = value
}
</script>
