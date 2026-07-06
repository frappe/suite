<script setup>
import { NodeViewWrapper, NodeViewContent } from '@tiptap/vue-3'
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  node: Object,
  editor: Object,
})

const isActive = ref(props.editor.storage.tab.activeTabId === props.node.attrs.id)

onMounted(() => {
  // Re-read storage in case changeTab fired before this node view mounted
  isActive.value = props.editor.storage.tab.activeTabId === props.node.attrs.id

  const handleTabChange = (e) => {
    isActive.value = e.detail.tabId === props.node.attrs.id
  }

  props.editor.view.dom.addEventListener('tab-changed', handleTabChange)
  onBeforeUnmount(() => {
    props.editor.view.dom.removeEventListener('tab-changed', handleTabChange)
  })
})
</script>

<template>
  <node-view-wrapper
    as="div"
    :data-tab-id="node.attrs.id"
    :data-tab-label="node.attrs.label"
    :style="{ display: isActive ? 'block' : 'none' }"
  >
    <node-view-content />
  </node-view-wrapper>
</template>
