<template>
  <DocumentFrame>
    <div ref="place" class="flex min-w-0 grow flex-col" />
  </DocumentFrame>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

import DocumentFrame from './DocumentFrame.vue'
import { placeOpeningEditor, releaseOpeningEditor } from './openingEditor'

const props = defineProps<{ node: string }>()
const place = useTemplateRef<HTMLElement>('place')

onMounted(() => {
  if (place.value) placeOpeningEditor(props.node, place.value)
})
onBeforeUnmount(() => releaseOpeningEditor(props.node))
</script>
