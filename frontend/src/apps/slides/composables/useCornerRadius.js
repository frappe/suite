import { computed, onBeforeUnmount, ref } from 'vue'

import { useElementProperty } from '@/apps/slides/composables/editProperty'
import { activeElement } from '@/apps/slides/stores/element'
import { selectionBounds, slideBounds } from '@/apps/slides/stores/slide'
import { MAX_BORDER_RADIUS } from '@/apps/slides/utils/constants'

const CORNER_VECTORS = {
  'top-left': { ux: 1, uy: 1 },
  'top-right': { ux: -1, uy: 1 },
  'bottom-left': { ux: 1, uy: -1 },
  'bottom-right': { ux: -1, uy: -1 },
}

export const useCornerRadius = () => {
  const isRounding = ref(false)
  const borderRadius = useElementProperty('borderRadius')

  const maxRadius = computed(() => {
    const minSide = Math.min(selectionBounds.width, selectionBounds.height)
    return Math.min(MAX_BORDER_RADIUS, minSide / 2)
  })

  let corner = null
  let startRadius = 0
  let startX = 0
  let startY = 0

  const round = (e) => {
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    const phi = -((activeElement.value?.rotation || 0) * Math.PI) / 180
    const localX = dx * Math.cos(phi) - dy * Math.sin(phi)
    const localY = dx * Math.sin(phi) + dy * Math.cos(phi)

    const { ux, uy } = CORNER_VECTORS[corner]
    const projected = (localX * ux + localY * uy) / Math.SQRT2 / slideBounds.scale

    const next = Math.min(Math.max(startRadius + projected, 0), maxRadius.value)
    borderRadius.set(Math.round(next * 2) / 2)
  }

  const stopRound = () => {
    window.removeEventListener('mousemove', round)
    isRounding.value = false
    borderRadius.commit()
  }

  const startRound = (activeCorner, e) => {
    e.preventDefault()
    e.stopPropagation()

    corner = activeCorner
    borderRadius.begin()
    isRounding.value = true
    startRadius = activeElement.value?.borderRadius ?? 0
    startX = e.clientX
    startY = e.clientY

    window.addEventListener('mousemove', round)
    window.addEventListener('mouseup', stopRound, { once: true })
  }

  onBeforeUnmount(() => window.removeEventListener('mousemove', round))

  return { isRounding, maxRadius, startRound }
}
