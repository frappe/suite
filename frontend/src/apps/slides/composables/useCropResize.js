import { onBeforeUnmount } from 'vue'

import { cropElement, draftCrop } from '@/apps/slides/stores/imageCrop'
import { interactionOffset } from '@/apps/slides/stores/interaction'
import { slideBounds } from '@/apps/slides/stores/slide'
import { resizeCrop } from '@/apps/slides/utils/cropGeometry'
import { getMinSizeForElement, getResizedBox, getRotatedVector } from '@/apps/slides/utils/resize'

const MIRROR_X = { left: 'right', right: 'left' }
const MIRROR_Y = { top: 'bottom', bottom: 'top' }

// the visual handle on a flipped image grabs the opposite logical edge
const mirrorHandle = (handle, el) => {
  let parts = handle.split('-')
  if (el.invertX == -1) parts = parts.map((part) => MIRROR_X[part] ?? part)
  if (el.invertY == -1) parts = parts.map((part) => MIRROR_Y[part] ?? part)
  return parts.join('-')
}

// drag a crop handle: the frame follows the handle while the visible content
// stays pinned. the frame goes into interactionOffset, the crop into the draft
export const useCropResize = (borderInset) => {
  let resizeStart = null

  // screen pixels to slide units, onto local axes, flip folded into the sign
  const screenDeltaToLocal = (e, el) => {
    const dx = (e.clientX - resizeStart.x) / slideBounds.scale
    const dy = (e.clientY - resizeStart.y) / slideBounds.scale
    const local = getRotatedVector({ x: dx, y: dy }, -resizeStart.box.rotation)
    return { x: local.x * (el.invertX || 1), y: local.y * (el.invertY || 1) }
  }

  // unfold the clamped delta and move the frame with it, verbatim
  const moveFrameBy = (localEdgeDelta, el) => {
    const { box, handle } = resizeStart
    const movement = getRotatedVector(
      { x: localEdgeDelta.x * (el.invertX || 1), y: localEdgeDelta.y * (el.invertY || 1) },
      box.rotation,
    )
    const resized = getResizedBox(box, handle, movement, { lockAspect: false, clampMinSize: false })

    interactionOffset.left = resized.left - el.left
    interactionOffset.top = resized.top - el.top
    interactionOffset.width = resized.width - el.width
    interactionOffset.height = resized.height - el.height
  }

  const resize = (e) => {
    const el = cropElement.value
    if (!resizeStart || !el) return

    const { crop, frame, minFrame, logicalHandle } = resizeStart
    const clamped = resizeCrop(crop, frame, logicalHandle, screenDeltaToLocal(e, el), minFrame)

    draftCrop.value = clamped.crop
    moveFrameBy(clamped.localEdgeDelta, el)
  }

  const stopResize = () => {
    resizeStart = null
    window.removeEventListener('mousemove', resize)
  }

  const startResize = (e, handle) => {
    e.preventDefault()

    const el = cropElement.value
    const inset = borderInset.value

    // each gesture starts from committed state plus earlier gestures' offset
    const box = {
      left: el.left + interactionOffset.left,
      top: el.top + interactionOffset.top,
      width: el.width + interactionOffset.width,
      height: el.height + interactionOffset.height,
      rotation: el.rotation || 0,
      type: el.type,
    }

    // a border wider than the element leaves no content box to resize in
    if (box.width <= 2 * inset || box.height <= 2 * inset) return

    const minSize = getMinSizeForElement(el.type)

    resizeStart = {
      x: e.clientX,
      y: e.clientY,
      box,
      crop: { ...draftCrop.value },
      // the crop maps to the content box, inside the border
      frame: { width: box.width - 2 * inset, height: box.height - 2 * inset },
      minFrame: {
        width: Math.max(1, minSize.width - 2 * inset),
        height: Math.max(1, minSize.height - 2 * inset),
      },
      handle,
      logicalHandle: mirrorHandle(handle, el),
    }

    window.addEventListener('mousemove', resize)
    window.addEventListener('mouseup', stopResize, { once: true })
  }

  onBeforeUnmount(() => window.removeEventListener('mousemove', resize))

  return { startResize }
}
