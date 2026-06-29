<template>
  <div
    v-if="editor && tabs.length > 0 && activeTabId"
    class="md:hidden fixed bottom-0 w-screen z-10 border-t border-outline-gray-2 bg-surface-base"
  >
    <div class="flex overflow-x-auto px-2 py-2 gap-1">
      <TabButtons
        v-model="activeTabId"
        :options="
          tabs.map((k) => ({
            label: k.label,
            value: k.id,
            onClick: () =>
              k.id !== activeTabId && editor.commands.changeTab(k.id),
          }))
        "
      />
    </div>
  </div>
</template>
<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'

import { ref } from 'vue'
import { TabButtons } from 'frappe-ui'

const activeTabId = ref()
onMounted(() => {
  const handleTabChange = (e) => {
    activeTabId.value = e.detail.tabId
  }

  props.editor.view.dom.addEventListener('tab-changed', handleTabChange)
})

// onBeforeUnmount(() => {
//   props.editor.view.dom.removeEventListener('tab-changed', handleTabChange)
// })
const props = defineProps({
  editor: Object,
})
// Get all tabs from the document
const tabs = computed(() => {
  const t = []
  props.editor.state.doc.descendants((node) => {
    if (node.type.name === 'tab') {
      t.push({ id: node.attrs.id, label: node.attrs.label })
    }
  })
  return t
})
</script>
