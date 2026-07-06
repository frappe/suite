<template>
  <CoreEditor
    v-if="contentReady"
    ref="textEditor"
    v-model:show-settings="showSettings"
    v-model:edited="edited"
    v-bind="{ ...props, ...commentsDetail }"
    :raw-content
    @editor-change="
      (val) => {
        if (val === rawContent) return
        rawContent = val
        if (db)
          db.transaction(['content'], 'readwrite')
            .objectStore('content')
            .put({ val, saved: new Date() }, props.file.name)
        if (!editable) return
        edited = true
        autosave()
      }
    "
    @save="save"
    @cleanup="commentsDetail.cleanup"
  />
</template>

<script setup>
import { debounce } from 'frappe-ui'
import { computed, ref, onBeforeUnmount, provide } from 'vue'
import { useComments } from '@/apps/writer/composables/useYjs'
import CoreEditor from './CoreEditor.vue'

const showSettings = defineModel('showSettings')
const edited = ref(false)

const props = defineProps({
  file: Object,
  document: Object,
  settings: Object,
  editable: Boolean,
})
const rawContent = ref(props.document.doc.html)
const contentReady = ref(!props.file.write)
const emit = defineEmits(['saveComment', 'saveDocument'])

const textEditor = ref('textEditor')
const editor = computed(() => {
  const editor = textEditor.value?.editor
  return editor
})
provide('editor', editor)
defineExpose({ editor })

const commentsDetail = useComments(props.document, editor)
const save = async (manual, html, onSuccess) => {
  await props.document.saveHtml.submit({ html: rawContent.value })
  onSuccess?.()
}
const autosave = debounce(save, 5000)

onBeforeUnmount(() => {
  if (edited.value) save()
})

// Local saving with IndexedDB
const db = ref(null)

if (props.file.write) {
  const request = window.indexedDB.open('Writer', 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('content'))
      request.result.createObjectStore('content')
  }
  request.onsuccess = (event) => {
    const database = event.target.result
    db.value = database
    database
      .transaction(['content'])
      .objectStore('content')
      .get(props.file.name).onsuccess = (val) => {
      if (
        val.target.result?.val?.length > 20 &&
        val.target.result.saved > new Date(props.file.modified)
      )
        rawContent.value = val.target.result.val
      contentReady.value = true
    }
  }
  request.onerror = () => {
    contentReady.value = true
  }
}
</script>
