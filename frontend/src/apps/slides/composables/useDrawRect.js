import { reactive, ref } from 'vue'

import { slideBounds } from '@/apps/slides/stores/slide'

// Shared rect-drawing logic used by MarqueeOverlay and ShapeDrawOverlay
export function useDrawRect() {
  const isDrawing = ref(false)
  const isShiftLocked = ref(false)
  const drawRect = reactive({ left: 0, top: 0, width: 0, height: 0 })
  const startPoint = reactive({ x: 0, y: 0 })
  const endPoint = reactive({ x: 0, y: 0 })

  let startX = 0
  let startY = 0
  let endCallback = null

  const toSlideCoords = (e) => ({
    x: (e.clientX - slideBounds.left) / slideBounds.scale,
    y: (e.clientY - slideBounds.top) / slideBounds.scale,
  })

  const updateRect = (e) => {
    const { x, y } = toSlideCoords(e)
    endPoint.x = x
    endPoint.y = y
    const dx = x - startX
    const dy = y - startY
    if (isShiftLocked.value) {
      const size = Math.min(Math.abs(dx), Math.abs(dy))
      drawRect.left = dx >= 0 ? startX : startX - size
      drawRect.top = dy >= 0 ? startY : startY - size
      drawRect.width = size
      drawRect.height = size
    } else {
      drawRect.left = Math.min(x, startX)
      drawRect.top = Math.min(y, startY)
      drawRect.width = Math.abs(dx)
      drawRect.height = Math.abs(dy)
    }
  }

  const endDrawing = () => {
    isDrawing.value = false
    document.removeEventListener('mousemove', updateRect)
    document.removeEventListener('mouseup', endDrawing)
    const rect = { ...drawRect }
    const p1 = { ...startPoint }
    const p2 = { ...endPoint }
    Object.assign(drawRect, { left: 0, top: 0, width: 0, height: 0 })
    endCallback?.(rect, p1, p2)
    endCallback = null
  }

  const startDrawing = (anchorEvent, onEnd) => {
    const { x, y } = toSlideCoords(anchorEvent)
    startX = x
    startY = y
    Object.assign(startPoint, { x, y })
    Object.assign(endPoint, { x, y })
    endCallback = onEnd
    isDrawing.value = true
    Object.assign(drawRect, { left: x, top: y, width: 0, height: 0 })

    document.addEventListener('mousemove', updateRect)
    document.addEventListener('mouseup', endDrawing)
  }

  const cancelDrawing = () => {
    endCallback = null
    isShiftLocked.value = false
    endDrawing()
  }

  return {
    isDrawing,
    isShiftLocked,
    drawRect,
    startPoint,
    endPoint,
    startDrawing,
    cancelDrawing,
  }
}
