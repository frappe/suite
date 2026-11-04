import type { Editor } from '@tiptap/core'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import { FIRST_TAB_ID, listTabs } from '@/apps/writer/extensions/tabs'

/** A document's tabs and the one on screen. The first tab alone is just the document, so it lists none. */
export function useDocumentTabs(editor: Editor) {
  const tabs = shallowRef<ReturnType<typeof listTabs>>([])
  const activeTabId = ref<string>()

  function updateTabs() {
    const all = listTabs(editor)
    tabs.value = all.length === 1 && all[0]?.id === FIRST_TAB_ID ? [] : all
  }

  function onTabChanged(event: Event) {
    activeTabId.value = (event as CustomEvent<{ tabId: string }>).detail.tabId
  }

  onMounted(() => {
    updateTabs()
    editor.on('update', updateTabs)
    editor.view.dom.addEventListener('tab-changed', onTabChanged)
    editor.view.dom.addEventListener('tab-renamed', updateTabs)
  })
  onBeforeUnmount(() => {
    editor.off('update', updateTabs)
    editor.view.dom.removeEventListener('tab-changed', onTabChanged)
    editor.view.dom.removeEventListener('tab-renamed', updateTabs)
  })

  return { tabs, activeTabId }
}
