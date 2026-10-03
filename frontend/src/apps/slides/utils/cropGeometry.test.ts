import { describe, expect, it } from 'vitest'

import {
  getCoverCrop,
  getCroppedImageBox,
  isFullRect,
  panCrop,
  resizeCrop,
} from '@/apps/slides/utils/cropGeometry'

const frame = { width: 200, height: 100 }

describe('getCroppedImageBox', () => {
  it('treats an absent crop as the full rect', () => {
    const fullFrame = { left: 0, top: 0, width: 200, height: 100 }
    expect(getCroppedImageBox(null, frame)).toEqual(fullFrame)
    expect(getCroppedImageBox(undefined, frame)).toEqual(fullFrame)
  })

  it('always places the crop rect exactly over the frame', () => {
    const crops = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
      { x: 0.5, y: 0, width: 0.5, height: 0.9 },
      { x: 0.33, y: 0.66, width: 0.17, height: 0.34 },
    ]
    for (const crop of crops) {
      const box = getCroppedImageBox(crop, frame)
      // the crop origin maps to the frame origin
      expect(box.left + crop.x * box.width).toBeCloseTo(0, 10)
      expect(box.top + crop.y * box.height).toBeCloseTo(0, 10)
      // and the crop rect spans the frame exactly
      expect(crop.width * box.width).toBeCloseTo(frame.width, 10)
      expect(crop.height * box.height).toBeCloseTo(frame.height, 10)
    }
  })
})

describe('isFullRect', () => {
  it('tolerates float dust from edge clamping', () => {
    expect(isFullRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true)
    expect(isFullRect({ x: 1e-12, y: -1e-12, width: 1 + 1e-12, height: 1 - 1e-12 })).toBe(true)
  })

  it('rejects a real crop', () => {
    expect(isFullRect({ x: 0, y: 0, width: 0.999, height: 1 })).toBe(false)
    expect(isFullRect({ x: 0.001, y: 0, width: 1, height: 1 })).toBe(false)
  })
})

describe('getCoverCrop', () => {
  it('trims the axis where the image overbleeds the frame, centred', () => {
    // a 2:1 image in a square frame: half the width shows
    expect(getCoverCrop(2, 1)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 })
    // a 1:2 image in a square frame: half the height shows
    expect(getCoverCrop(0.5, 1)).toEqual({ x: 0, y: 0.25, width: 1, height: 0.5 })
  })

  it('matching aspects show the full image', () => {
    expect(getCoverCrop(1.5, 1.5)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('falls back to the full rect when an aspect is not a positive finite number', () => {
    expect(getCoverCrop(NaN, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(getCoverCrop(2, NaN)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(getCoverCrop(0, 1)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(getCoverCrop(2, Infinity)).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('panCrop', () => {
  // image extent is frame / crop size: 400 wide, 400 tall
  const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.25 }

  it('slides the crop opposite the drag, in image fractions', () => {
    // 50px of drag is 50/400 of the image on each axis
    const panned = panCrop(crop, { x: 50, y: -50 }, frame)
    expect(panned).toEqual({ x: 0.125, y: 0.375, width: 0.5, height: 0.25 })
  })

  it('clamps to the image edges without changing size', () => {
    const pastTopLeft = panCrop(crop, { x: 10000, y: 10000 }, frame)
    expect(pastTopLeft).toEqual({ x: 0, y: 0, width: 0.5, height: 0.25 })

    const pastBottomRight = panCrop(crop, { x: -10000, y: -10000 }, frame)
    expect(pastBottomRight).toEqual({ x: 0.5, y: 0.75, width: 0.5, height: 0.25 })
  })
})

describe('resizeCrop', () => {
  // image extent is frame / crop size: 400 wide, 200 tall
  const crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }
  const minFrame = { width: 20, height: 40 }

  it('trades frame for crop at the image scale, from the grabbed edge only', () => {
    // dragging the left edge 40px inward eats 40/400 = 0.1 of the image
    const left = resizeCrop(crop, frame, 'left', { x: 40, y: 33 }, minFrame)
    expect(left.crop).toEqual({ x: 0.35, y: 0.25, width: 0.4, height: 0.5 })
    expect(left.localEdgeDelta).toEqual({ x: 40, y: 0 })

    const right = resizeCrop(crop, frame, 'right', { x: 100, y: 0 }, minFrame)
    expect(right.crop).toEqual({ x: 0.25, y: 0.25, width: 0.75, height: 0.5 })
    expect(right.localEdgeDelta).toEqual({ x: 100, y: 0 })

    const corner = resizeCrop(crop, frame, 'top-left', { x: 40, y: 20 }, minFrame)
    expect(corner.crop).toEqual({ x: 0.35, y: 0.35, width: 0.4, height: 0.4 })
    expect(corner.localEdgeDelta).toEqual({ x: 40, y: 20 })
  })

  it('clamps at the image edges', () => {
    const { crop: panned, localEdgeDelta } = resizeCrop(
      crop,
      frame,
      'right',
      { x: 500, y: 0 },
      minFrame,
    )
    expect(panned).toEqual({ x: 0.25, y: 0.25, width: 0.75, height: 0.5 })
    expect(localEdgeDelta).toEqual({ x: 100, y: 0 })

    const low = resizeCrop(crop, frame, 'left', { x: -500, y: 0 }, minFrame)
    expect(low.crop).toEqual({ x: 0, y: 0.25, width: 0.75, height: 0.5 })
    expect(low.localEdgeDelta).toEqual({ x: -100, y: 0 })
  })

  it('returns a zero delta when float drift leaves no room at the image edge', () => {
    // 0.9 + 0.1 is 1.0000000000000002 in doubles
    const drifted = { x: 0.9, y: 0.25, width: 0.1, height: 0.5 }
    const { crop: unchanged, localEdgeDelta } = resizeCrop(
      drifted,
      frame,
      'right',
      { x: 100, y: 0 },
      minFrame,
    )
    expect(localEdgeDelta).toEqual({ x: 0, y: 0 })
    expect(unchanged).toEqual(drifted)
  })

  it('clamps at the minimum frame size', () => {
    const { crop: tiny, localEdgeDelta } = resizeCrop(
      crop,
      frame,
      'left',
      { x: 10000, y: 0 },
      minFrame,
    )
    // the frame stops at 20px, so the delta stops at 180
    expect(localEdgeDelta).toEqual({ x: 180, y: 0 })
    expect(tiny.x).toBeCloseTo(0.7, 10)
    expect(tiny.width).toBeCloseTo(0.05, 10)
    expect(tiny).toMatchObject({ y: 0.25, height: 0.5 })

    const inward = resizeCrop(crop, frame, 'right', { x: -10000, y: 0 }, minFrame)
    expect(inward.localEdgeDelta).toEqual({ x: -180, y: 0 })
    expect(inward.crop.width).toBeCloseTo(0.05, 10)
    expect(inward.crop).toMatchObject({ x: 0.25, y: 0.25, height: 0.5 })
  })
})
