import tinycolor from 'tinycolor2'

export const migrateShadow = (el) => {
  // legacy px shadow (shadowSpread/shadowOffsetX/shadowOffsetY) -> size-relative model
  if (el.shadowOffset != null) return
  const hasLegacyShadow =
    el.shadowSpread != null || el.shadowOffsetX != null || el.shadowOffsetY != null
  if (!hasLegacyShadow) return

  const refSize = Number(el.width) || 1
  const offsetX = Number(el.shadowOffsetX || 0)
  const offsetY = Number(el.shadowOffsetY || 0)
  const toRelativeSize = (px) => Math.round((px / refSize) * 1000) / 10
  const offsetAngle = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360

  el.shadowBlur = toRelativeSize(Number(el.shadowSpread || 0))
  el.shadowOffset = toRelativeSize(Math.hypot(offsetX, offsetY))
  el.shadowAngle = offsetX || offsetY ? Math.round(offsetAngle) : 45
  el.shadowOpacity = Math.round(tinycolor(el.shadowColor || '#000000ff').getAlpha() * 100)

  delete el.shadowSpread
  delete el.shadowOffsetX
  delete el.shadowOffsetY
}
