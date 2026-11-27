import { expect, it, vi } from 'vitest'

import { bounds, parseScene, transformShape } from './selection'

vi.mock('@/platform/translation', () => ({ translate: (text: string) => text }))

const legacyStroke = {
  id: 'stroke',
  kind: 'freedraw',
  x: 12,
  y: 23,
  width: 28,
  height: 27,
  rotation: 0,
  cornerRadius: 0,
  points: [
    { x: 12, y: 23 },
    { x: 40, y: 50 },
  ],
  simulatePressure: true,
}

it('keeps legacy freehand artwork and supplies the default pressure per point', () => {
  const scene = { rectangles: [legacyStroke], lines: [] }

  expect(parseScene(scene).rectangles[0]).toEqual({
    ...legacyStroke,
    pressures: [0.5, 0.5],
  })
  expect(scene.rectangles[0]).toEqual(legacyStroke)
})

it.each([
  ['not an array', '0.5'],
  ['wrong length', [0.5]],
  ['outside the pressure range', [0.5, 1.1]],
])('rejects supplied freehand pressure data that is %s', (_reason, pressures) => {
  expect(() => parseScene({ rectangles: [{ ...legacyStroke, pressures }], lines: [] })).toThrow(
    'Invalid free draw pressure',
  )
})

it('computes bounds for a scene at both the object and freehand point limits', () => {
  const stroke = {
    ...legacyStroke,
    points: Array.from({ length: 100_000 }, (_, index) => ({
      x: index,
      y: 100_000 - index,
    })),
  }
  const rectangles = Array.from({ length: 9_999 }, (_, index) => ({
    id: String(index),
    x: -index - 1,
    y: -2 * (index + 1),
    width: 1,
    height: 2,
    rotation: 0,
    cornerRadius: 0,
  }))

  expect(bounds([stroke, ...rectangles])).toMatchObject({
    x: -9_999,
    y: -19_998,
    width: 109_998,
    height: 119_998,
  })
  expect(
    transformShape(
      stroke,
      { id: 'selection', x: 0, y: 0, width: 99_999, height: 99_999, rotation: 0, cornerRadius: 0 },
      {
        id: 'selection',
        x: 10,
        y: 20,
        width: 199_998,
        height: 199_998,
        rotation: 0,
        cornerRadius: 0,
      },
    ),
  ).toMatchObject({ x: 10, y: 22, width: 199_998, height: 199_998 })
})

it('uses saved geometry for legacy empty strokes and returns no bounds for no shapes', () => {
  expect(bounds([{ ...legacyStroke, points: [] }])).toMatchObject({
    x: 12,
    y: 23,
    width: 28,
    height: 27,
  })
  expect(bounds([])).toBeUndefined()
})
