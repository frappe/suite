import { describe, expect, it, vi } from 'vitest'

import { getCroppedImageBox, resizeCrop } from '@/apps/slides/utils/cropGeometry'
import { getResizedBox } from '@/apps/slides/utils/resize'

// resize.js reaches mediaUploads via helpers.ts, which drags in the whole app
vi.mock('@/apps/slides/utils/mediaUploads', () => ({ getAttachmentUrl: () => '' }))

describe('resizeCrop composed with getResizedBox', () => {
  // image extent is frame / crop size: 400 wide, 250 tall; nothing symmetric, so axis mixups can't cancel
  const crop = { x: 0.25, y: 0.3, width: 0.5, height: 0.4 }
  const minFrame = { width: 20, height: 20 }

  it('keeps the content pinned in slide space', () => {
    const HANDLES = [
      'top-left',
      'top',
      'top-right',
      'right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'left',
    ]
    const CONFIGS = [
      { rotation: 0, invertX: 1, invertY: 1 },
      { rotation: 30, invertX: 1, invertY: 1 },
      { rotation: 0, invertX: -1, invertY: 1 },
      { rotation: 30, invertX: 1, invertY: -1 },
      { rotation: -17, invertX: -1, invertY: -1 },
    ]
    // a free drag, then huge drags that engage every clamp in both directions
    const DELTAS = [
      { x: 30, y: -20 },
      { x: 4000, y: 4000 },
      { x: -4000, y: -4000 },
    ]

    for (const config of CONFIGS) {
      for (const handle of HANDLES) {
        for (const delta of DELTAS) {
          const start = {
            left: 300,
            top: 150,
            width: 200,
            height: 100,
            type: 'image',
            rotation: config.rotation,
          }

          // fold flip into the logical space, the way the overlay does
          const folded = { x: delta.x * config.invertX, y: delta.y * config.invertY }
          const result = resizeCrop(crop, start, mirrorHandle(handle, config), folded, minFrame)

          // unfold the clamped delta and move the frame with it
          const movement = rotatePoint(
            {
              x: result.localEdgeDelta.x * config.invertX,
              y: result.localEdgeDelta.y * config.invertY,
            },
            config.rotation,
          )
          const box = getResizedBox(start, handle, movement, {
            lockAspect: false,
            clampMinSize: false,
          })

          // a dead handle would pass the pinning check trivially
          if (delta == DELTAS[0]) {
            const grabsX = handle.includes('left') || handle.includes('right')
            const grabsY = handle.includes('top') || handle.includes('bottom')
            expect(result.localEdgeDelta.x != 0, `${handle} moves x`).toBe(grabsX)
            expect(result.localEdgeDelta.y != 0, `${handle} moves y`).toBe(grabsY)
          }

          const before = contentCorners(start, crop, config)
          const after = contentCorners(box, result.crop, config)

          before.forEach((corner, i) => {
            expect(after[i].x, `${handle} ${JSON.stringify(config)}`).toBeCloseTo(corner.x, 8)
            expect(after[i].y, `${handle} ${JSON.stringify(config)}`).toBeCloseTo(corner.y, 8)
          })
        }
      }
    }
  })
})

const MIRROR: Record<string, string> = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
}

const mirrorHandle = (handle: string, config: { invertX: number; invertY: number }) =>
  handle
    .split('-')
    .map((part) => {
      if (config.invertX == -1 && (part == 'left' || part == 'right')) return MIRROR[part]
      if (config.invertY == -1 && (part == 'top' || part == 'bottom')) return MIRROR[part]
      return part
    })
    .join('-')

const rotatePoint = (p: { x: number; y: number }, degrees: number) => {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

// image corners in slide space: crop, then flip about the frame centre, then rotation, like the CSS
const contentCorners = (
  box: Box,
  crop: { x: number; y: number; width: number; height: number },
  config: { rotation: number; invertX: number; invertY: number },
) => {
  const img = getCroppedImageBox(crop, box)
  const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 }

  return [
    { x: img.left, y: img.top },
    { x: img.left + img.width, y: img.top + img.height },
  ]
    .map((p) => ({
      x: config.invertX == -1 ? box.width - p.x : p.x,
      y: config.invertY == -1 ? box.height - p.y : p.y,
    }))
    .map((p) => {
      const rotated = rotatePoint(
        { x: p.x - box.width / 2, y: p.y - box.height / 2 },
        config.rotation,
      )
      return { x: center.x + rotated.x, y: center.y + rotated.y }
    })
}
