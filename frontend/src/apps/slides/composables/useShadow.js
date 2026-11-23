import tinycolor from 'tinycolor2'
import { computed } from 'vue'

import { defaultShadowColor } from '@/apps/slides/utils/constants'

const resolveOffset = (el, refSize) => {
  const distance = (Number(el.shadowOffset ?? 0) / 100) * refSize
  const radians = (Number(el.shadowAngle ?? 45) * Math.PI) / 180
  return { x: distance * Math.cos(radians), y: distance * Math.sin(radians) }
}

const resolveShadow = (el) => {
  const refSize = Number(el.width) || 0

  return {
    color: tinycolor(el.shadowColor || defaultShadowColor),
    alpha: Number(el.shadowOpacity ?? 100) / 100,
    blur: (Number(el.shadowBlur ?? 0) / 100) * refSize,
    offset: resolveOffset(el, refSize),
  }
}

export const useBoxShadow = (element) => {
  return computed(() => {
    const el = element.value
    if (!el) return 'none'

    const { color, alpha, blur, offset } = resolveShadow(el)
    return `${offset.x}px ${offset.y}px ${blur}px ${color.setAlpha(alpha).toRgbString()}`
  })
}

const emptySvgShadow = {
  hasShadow: false,
  offsetX: 0,
  offsetY: 0,
  stdDeviation: 0,
  color: '#000000',
  opacity: 1,
}

export const useSvgShadow = (element) => {
  return computed(() => {
    const el = element.value
    if (!el) return emptySvgShadow

    const { color, alpha, blur, offset } = resolveShadow(el)
    return {
      hasShadow: Boolean(offset.x || offset.y || blur),
      offsetX: offset.x,
      offsetY: offset.y,
      stdDeviation: blur / 2,
      color: color.toHexString(),
      opacity: alpha,
    }
  })
}
