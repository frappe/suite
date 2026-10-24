import { expect, it } from 'vitest'

import { copyFreeDraw, moveFreeDraw, type FreeDrawShape } from './scene'

const legacyStroke = {
  id: 'stroke',
  kind: 'freedraw' as const,
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

it('copies legacy freehand artwork without requiring pressure samples', () => {
  const original = structuredClone(legacyStroke)
  const copy = copyFreeDraw(legacyStroke as FreeDrawShape)

  expect(copy).toEqual({ ...legacyStroke, pressures: [0.5, 0.5] })
  expect(copy.points).not.toBe(legacyStroke.points)
  expect(copy.points[0]).not.toBe(legacyStroke.points[0])
  expect(legacyStroke).toEqual(original)
})

it('moves freehand points and bounds together without changing the source', () => {
  const original = { ...legacyStroke, pressures: [0.4, 0.8] }
  const moved = moveFreeDraw(original, { x: 10, y: -5 })

  expect(moved).toMatchObject({
    x: 22,
    y: 18,
    width: 28,
    height: 27,
    points: [
      { x: 22, y: 18 },
      { x: 50, y: 45 },
    ],
  })
  expect(moved.pressures).toEqual([0.4, 0.8])
  expect(original).toEqual({ ...legacyStroke, pressures: [0.4, 0.8] })
})
