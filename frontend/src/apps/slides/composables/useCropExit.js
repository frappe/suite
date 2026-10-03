import { onBeforeUnmount, onMounted } from 'vue'

import { commitCrop, cropElement } from '@/apps/slides/stores/imageCrop'

// owns leaving crop mode by clicking outside the crop UI: the click commits
// and exits, and never edits: no marquee, no selection, no panel action
export const useCropExit = (controlsFrame) => {
  let swallowNextClick = false

  const onDocumentMousedown = (e) => {
    // a swallowed mousedown whose click never fired must not eat this one's
    swallowNextClick = false

    if (!cropElement.value) return
    if (controlsFrame.value?.contains(e.target)) return

    e.preventDefault()
    e.stopPropagation()

    // right-click is only suppressed; the contextmenu handler is gated on the mode
    if (e.button == 2) return

    swallowNextClick = true
    commitCrop()
  }

  // buttons act on click, which still fires after a swallowed mousedown
  const onDocumentClick = (e) => {
    if (!swallowNextClick) return
    swallowNextClick = false

    e.preventDefault()
    e.stopPropagation()
  }

  onMounted(() => {
    document.addEventListener('mousedown', onDocumentMousedown, true)
    document.addEventListener('click', onDocumentClick, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocumentMousedown, true)
    document.removeEventListener('click', onDocumentClick, true)
  })
}
