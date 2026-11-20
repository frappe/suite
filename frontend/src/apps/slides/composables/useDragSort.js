import { onBeforeUnmount, ref } from 'vue'

export const useDragSort = (containerRef, itemCountRef, itemSize, onSortEnd) => {
  const itemStartIndex = ref(null)
  const itemPreviewIndex = ref(null)

  const startMouseY = ref(0)
  const startScrollTop = ref(0)

  const suppressNextClick = ref(false)

  const handleSortStart = (event, index) => {
    if (event.button !== 0) return

    itemStartIndex.value = index
    itemPreviewIndex.value = index

    startMouseY.value = event.clientY
    startScrollTop.value = containerRef.value.scrollTop

    window.addEventListener('mousemove', handleSortMove)
    window.addEventListener('mouseup', handleSortEnd)
  }

  const handleSortMove = (event) => {
    if (itemStartIndex.value == null) return

    const mouseDelta = event.clientY - startMouseY.value
    const scrollDelta = containerRef.value.scrollTop - startScrollTop.value

    const indexDelta = Math.trunc((mouseDelta + scrollDelta) / itemSize)

    const rawPreviewIndex = itemStartIndex.value + indexDelta
    const lastIndex = itemCountRef.value - 1
    const nextPreviewIndex = Math.max(0, Math.min(lastIndex, rawPreviewIndex))

    itemPreviewIndex.value = nextPreviewIndex
  }

  const cleanup = () => {
    window.removeEventListener('mousemove', handleSortMove)
    window.removeEventListener('mouseup', handleSortEnd)

    itemStartIndex.value = null
    itemPreviewIndex.value = null
  }

  const didItemMove = () => {
    return (
      itemStartIndex.value != null &&
      itemPreviewIndex.value != null &&
      itemStartIndex.value !== itemPreviewIndex.value
    )
  }

  const handleSortEnd = () => {
    if (!didItemMove()) {
      cleanup()
      return
    }

    const nextSortChange = {
      oldIndex: itemStartIndex.value,
      newIndex: itemPreviewIndex.value,
    }
    suppressNextClick.value = true

    cleanup()

    onSortEnd?.(nextSortChange)
  }

  const shouldIgnoreClick = () => {
    if (!suppressNextClick.value) return false

    suppressNextClick.value = false
    return true
  }

  onBeforeUnmount(cleanup)

  return {
    itemStartIndex,
    itemPreviewIndex,
    handleSortStart,
    shouldIgnoreClick,
  }
}
