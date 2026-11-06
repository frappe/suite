<template>
  <div
    v-if="isBarShown"
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
import { TabButtons } from 'frappe-ui'
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'

import { useDocumentTabs } from './useDocumentTabs'

const props = defineProps({
  editor: Object,
})

const bar = ref(null)

// Anything else pinned to the bottom on mobile (comment cards) needs to clear the bar.
const setBarHeight = (height) =>
  document.documentElement.style.setProperty('--writer-tab-bar-height', `${height}px`)

let observer

watchEffect(() => {
  observer?.disconnect()
  if (!bar.value) return setBarHeight(0)
  observer = new ResizeObserver(([entry]) => setBarHeight(entry.contentRect.height))
  observer.observe(bar.value)
})

const { tabs, activeTabId, selectTab } = useDocumentTabs(props.editor)

const isBarShown = computed(() => tabs.value.length > 1 && !!activeTabId.value)

onBeforeUnmount(() => {
  observer?.disconnect()
  setBarHeight(0)
})
</script>
