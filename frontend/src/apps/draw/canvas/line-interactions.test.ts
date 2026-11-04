import { expect, it } from 'vitest'

import { moveLine } from './line-interactions'
import { lineControlPoint, linePointAt } from './scene'

it('translates curved lines and preserves both absolute and relative curves', () => {
  const curved = {
    id: 'absolute-curve',
    kind: 'line' as const,
    start: { x: 2, y: 3 },
    end: { x: 8, y: 9 },
    curve: { x: 14, y: 5 },
  }
  const movedCurve = moveLine(curved, { x: 10, y: 20 })

  expect(movedCurve).toMatchObject({
    start: { x: 12, y: 23 },
    end: { x: 18, y: 29 },
    curve: { x: 24, y: 25 },
  })
  expect(linePointAt(movedCurve, 0.4)).toEqual({
    x: linePointAt(curved, 0.4).x + 10,
    y: linePointAt(curved, 0.4).y + 20,
  })
  expect(curved).toEqual({
    id: 'absolute-curve',
    kind: 'line',
    start: { x: 2, y: 3 },
    end: { x: 8, y: 9 },
    curve: { x: 14, y: 5 },
  })

  const relative = { ...curved, curve: 7 }
  const movedRelative = moveLine(relative, { x: 10, y: 20 })
  expect(movedRelative.curve).toBe(7)
  expect(lineControlPoint(movedRelative)).toEqual({
    x: lineControlPoint(relative).x + 10,
    y: lineControlPoint(relative).y + 20,
  })
})
