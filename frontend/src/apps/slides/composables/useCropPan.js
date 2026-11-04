import { onBeforeUnmount } from 'vue'

import { cropElement, draftCrop } from '@/apps/slides/stores/imageCrop'
import { interactionOffset } from '@/apps/slides/stores/interaction'
import { slideBounds } from '@/apps/slides/stores/slide'
import { panCrop } from '@/apps/slides/utils/cropGeometry'

const DRAG_START_THRESHOLD = 4

// drag inside the crop window to pan the image behind it. writes only the
// draft; committed state is untouched until exit
export const useCropPan = (borderInset) => {
  let panStart = null

  // the mouse moves in screen space, the crop lives in the element's local
  // space. undo each transform between the two: zoom, then rotation, then flip
  const screenDeltaToLocal = (e, el) => {
    // screen pixels to slide units
    const dx = (e.clientX - panStart.x) / slideBounds.scale
    const dy = (e.clientY - panStart.y) / slideBounds.scale

    // rotate backwards by the element's angle
    const phi = -((el.rotation || 0) * Math.PI) / 180
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)

    // a flipped axis runs the other way, so the delta's sign flips with it
    return {
      x: (dx * cos - dy * sin) * (el.invertX || 1),
      y: (dx * sin + dy * cos) * (el.invertY || 1),
    }
  }

  const pan = (e) => {
    const el = cropElement.value
    if (!panStart || !el) return

    // click jitter must not pan; a double click needs two still clicks to land
    if (!panStart.started) {
      const distance = Math.hypot(e.clientX - panStart.x, e.clientY - panStart.y)
      if (distance < DRAG_START_THRESHOLD) return
      panStart.started = true
    }

    // mid-session the frame carries the uncommitted offset of earlier drags
    const inset = borderInset.value
    const frame = {
      width: el.width + interactionOffset.width - 2 * inset,
      height: el.height + interactionOffset.height - 2 * inset,
    }

    draftCrop.value = panCrop(panStart.crop, screenDeltaToLocal(e, el), frame)
  }

  const stopPan = () => {
    panStart = null
    window.removeEventListener('mousemove', pan)
  }

  const startPan = (e) => {
    e.preventDefault()

    panStart = { x: e.clientX, y: e.clientY, crop: { ...draftCrop.value } }

    window.addEventListener('mousemove', pan)
    window.addEventListener('mouseup', stopPan, { once: true })
  }

  onBeforeUnmount(() => window.removeEventListener('mousemove', pan))

  return { startPan }
}
