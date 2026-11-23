import { ref } from 'vue'

import { activeElement, activeElementIds } from '@/apps/slides/stores/element'

const isNavigationPanelOpen = ref(true)

const toggleNavigationPanel = (e) => {
  if (!activeElementIds.value.length || e.type === 'click') {
    isNavigationPanelOpen.value = !isNavigationPanelOpen.value
  }
}

export const useNavigationPanel = () => {
  return {
    isNavigationPanelOpen,
    toggleNavigationPanel,
  }
}
