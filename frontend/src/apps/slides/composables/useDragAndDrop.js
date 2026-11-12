import { ref } from 'vue'

export const useDragAndDrop = () => {
  const isDragging = ref(false)

  // total displacement from the press position (viewport px),
  // flushed at most once per animation frame
  const positionDelta = ref({ left: 0, top: 0 })

  let startX = 0
  let startY = 0
  let lastX = 0
  let lastY = 0
  let frame = null

  const flushDelta = () => {
    frame = null
    positionDelta.value = {
      left: lastX - startX,
      top: lastY - startY,
    }
  }

  const startDragging = (e) => {
    e.preventDefault()
    e.stopPropagation()

    isDragging.value = true

    startX = lastX = e.clientX
    startY = lastY = e.clientY

    positionDelta.value = { left: 0, top: 0 }

    window.addEventListener('mousemove', drag)
    window.addEventListener('mouseup', stopDragging)
  }

  const drag = (e) => {
    e.preventDefault()

    if (!isDragging.value) return

    // button was released outside the window — end the gesture so the
    // pending offsets get committed instead of leaking into the next drag
    if (!e.buttons) return stopDragging(e)

    lastX = e.clientX
    lastY = e.clientY

    if (!frame) frame = requestAnimationFrame(flushDelta)
  }

  const stopDragging = (e) => {
    e.preventDefault()
    e.stopPropagation()

    // flush movement still waiting on the next frame so the
    // final position is exact
    if (frame) {
      cancelAnimationFrame(frame)
      flushDelta()
    }

    isDragging.value = false

    window.removeEventListener('mousemove', drag)
    window.removeEventListener('mouseup', stopDragging)
  }

  return { isDragging, positionDelta, startDragging }
}
