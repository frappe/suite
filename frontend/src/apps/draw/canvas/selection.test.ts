import { expect, it, vi } from 'vitest'

import { parseScene } from './selection'

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
