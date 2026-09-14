<template>
  <GenericPage
    :get-entities="getAttachments"
    :empty="{
      icon: LucidePaperclip,
      title: 'No attachments yet',
      description: 'Files attached to documents will show up here.',
    }"
  />
</template>

<script setup>
import GenericPage from '@/apps/drive/components/GenericPage.vue'
import { getAttachments } from '@/apps/drive/resources/files'
import LucidePaperclip from '~icons/lucide/paperclip'
import { watch } from 'vue'

const props = defineProps({
  doctype: {
    type: String,
    required: false,
  },
  docname: {
    type: String,
    required: false,
  },
})
watch(
  () => [props.doctype, props.docname],
  ([doctype, docname]) => {
    getAttachments.params = {
      ...getAttachments.params,
      doctype,
      docname,
    }
  },
  { immediate: true }
)
</script>
