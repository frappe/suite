<template>
  <div
    v-if="editor && tabs.length > 0 && activeTabId"
    ref="bar"
    class="md:hidden fixed bottom-0 w-screen z-10 border-t border-outline-gray-2 bg-surface-base"
  >
    <div class="flex overflow-x-auto px-2 py-2 gap-1">
      <TabButtons
        :model-value="activeTabId"
        :options="tabs.map((k) => ({ label: k.label, value: k.id }))"
        @update:model-value="selectTab"
      />
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount, watchEffect } from 'vue'
import { TabButtons } from 'frappe-ui'
import { orderedTabs } from '@/apps/writer/extensions/tabs'

const props = defineProps({
  editor: Object,
})

const bar = ref(null)

// Anything else pinned to the bottom on mobile (comment cards) needs to clear the bar.
const setBarHeight = (height) =>
  document.documentElement.style.setProperty(
    '--writer-tab-bar-height',
    `${height}px`,
  )

let observer
watchEffect(() => {
  observer?.disconnect()
  if (!bar.value) return setBarHeight(0)
  observer = new ResizeObserver(([entry]) =>
    setBarHeight(entry.contentRect.height),
  )
  observer.observe(bar.value)
})

// doc isn't reactive, so re-derive on every update
const tabs = ref([])
const updateTabs = () => {
  tabs.value = orderedTabs(props.editor.state.doc).map(({ node }) => ({
    id: node.attrs.id,
    label: node.attrs.label,
  }))
}

const activeTabId = ref(props.editor.storage.tab?.activeTabId ?? null)
const handleTabChange = (e) => {
  activeTabId.value = e.detail.tabId
}

const selectTab = (id) => {
  if (id && id !== activeTabId.value) props.editor.commands.changeTab(id)
}

// Held from mount: on teardown the editor view may already be destroyed, and
// tiptap's post-destroy `view` proxy throws on any key it doesn't stub (`dom`
// is one). Throwing here aborts Vue's unmount, so the next route never mounts.
let editorDom = null

onMounted(() => {
  updateTabs()
  activeTabId.value = props.editor.storage.tab?.activeTabId ?? activeTabId.value
  props.editor.on('update', updateTabs)
  editorDom = props.editor.view.dom
  editorDom.addEventListener('tab-changed', handleTabChange)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  setBarHeight(0)
  props.editor.off('update', updateTabs)
  editorDom?.removeEventListener('tab-changed', handleTabChange)
  editorDom = null
})
</script>
