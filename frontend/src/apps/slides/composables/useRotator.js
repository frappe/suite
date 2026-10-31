import { ref } from 'vue'

import { getElementCenter } from '@/apps/slides/stores/element'
import { rotationDelta } from '@/apps/slides/stores/interaction'

export const useRotator = () => {
  const isRotating = ref(false)

  let startAngle = 0
  let centerX = 0
  let centerY = 0

  const getAngle = (mouseX, mouseY) => {
    const dx = mouseX - centerX
    const dy = mouseY - centerY
    // return angle in degrees normalized to [0, 360)
    const ang = Math.atan2(dy, dx) * (180 / Math.PI)
    return ((ang % 360) + 360) % 360
  }

  const startRotate = (e) => {
    e.preventDefault()
    e.stopPropagation()

    isRotating.value = true
    rotationDelta.value = 0

    centerX = getElementCenter('X')
    centerY = getElementCenter('Y')

    startAngle = getAngle(e.clientX, e.clientY)

    window.addEventListener('mousemove', rotate)
    window.addEventListener('mouseup', stopRotate, { once: true })
  }

  const rotate = (e) => {
    if (!isRotating.value) return

    const currentAngle = getAngle(e.clientX, e.clientY)

    // Calculate the angle difference from the start angle
    let delta = currentAngle - startAngle

    // Normalize delta to the range [-180, 180]
    if (delta > 180) {
      delta -= 360
    } else if (delta < -180) {
      delta += 360
    }

    rotationDelta.value = delta
  }

  const stopRotate = () => {
    isRotating.value = false

    window.removeEventListener('mousemove', rotate)
  }

  return { isRotating, rotationDelta, startRotate }
}
