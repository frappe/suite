export function constrainRotationAngle(angle: number, increment: number): number {
  return normalizeAngle(Math.round(normalizeAngle(angle) / increment) * increment)
}

export function snapRotationAngle(angle: number, increment: number, tolerance: number): number {
  const normalized = normalizeAngle(angle)
  const snapped = constrainRotationAngle(normalized, increment)
  return Math.min(Math.abs(normalized - snapped), 360 - Math.abs(normalized - snapped)) <= tolerance
    ? snapped
    : normalized
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360
}
