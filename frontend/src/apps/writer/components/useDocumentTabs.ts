import type { Editor } from '@tiptap/core'
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import { listTabs } from '@/apps/writer/extensions/tabs'

/** A document's tabs and the one on screen. A single tab is just the document, so it lists none. */
export function useDocumentTabs(editor: Editor) {
  const tabs = shallowRef<ReturnType<typeof listTabs>>([])
  // The tab row unmounts under a version preview, and no event says which tab it comes back to
  const activeTabId = ref(editor.storage.tab?.activeTabId ?? undefined)

  function updateTabs() {
    const all = listTabs(editor)
    tabs.value = all.length > 1 ? all : []
  }

  function onTabChanged(event: Event) {
    if (!('detail' in event)) return
    const detail = event.detail
    if (
      !detail ||
      typeof detail !== 'object' ||
      !('tabId' in detail) ||
      typeof detail.tabId !== 'string'
    )
      return
    activeTabId.value = detail.tabId
  }

  // A caller can unmount after the editor is destroyed, when its view is gone
  let dom: HTMLElement | undefined
  onMounted(() => {
    updateTabs()
    editor.on('update', updateTabs)
    dom = editor.view.dom
    dom.addEventListener('tab-changed', onTabChanged)
    dom.addEventListener('tab-renamed', updateTabs)
  })
  onBeforeUnmount(() => {
    editor.off('update', updateTabs)
    dom?.removeEventListener('tab-changed', onTabChanged)
    dom?.removeEventListener('tab-renamed', updateTabs)
  })

  function selectTab(id: string) {
    if (id && id !== activeTabId.value) editor.commands.changeTab(id)
  }

  return { tabs, activeTabId, selectTab }
}
