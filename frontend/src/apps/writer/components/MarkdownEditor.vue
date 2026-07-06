<script setup>
import { provide, computed, ref, useTemplateRef } from 'vue'
import {
  Editor,
  EditorFixedMenu,
  EditorContent,
  EditorTableMenu,
  EditorDropZone,
  RichTextKit,
  articleToolbar,
} from 'frappe-ui/editor'

const props = defineProps({
  document: Object,
  settings: Object,
})

const content = ref(props.document.doc.file_content)
const editorEl = useTemplateRef('editorEl')
const editor = computed(() => editorEl.value?.editor)
provide('editor', editor)

const extensions = [RichTextKit]
</script>

<template>
  <div class="flex flex-col w-full">
    <EditorFixedMenu
      v-if="editor"
      :editor="editor"
      :items="articleToolbar"
      class="w-full max-w-[100vw] overflow-x-auto border-b border-outline-elevation-2 justify-start md:justify-center py-1.5 shrink-0"
    />
    <div class="overflow-y-auto">
      <div
        class="mx-auto cursor-text w-full flex justify-center h-full md:min-w-[48rem] md:max-w-[48rem] py-7"
      >
        <Editor ref="editorEl" v-model="content" :extensions>
          <template #default="{ editor }">
            <EditorTableMenu :editor />
            <EditorDropZone :editor>
              <EditorContent
                class="prose-sm prose-v3"
                :style="{
                  fontFamily: `var(--font-${settings?.font_family})`,
                  fontSize: `${settings?.font_size || 15}px`,
                  lineHeight: settings?.line_height || 1.5,
                }"
                :editor
              />
            </EditorDropZone>
          </template>
        </Editor>
      </div>
    </div>
  </div>
</template>
