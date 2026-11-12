import { describe, expect, it } from 'vitest'

import { clampListWidth } from './splitWidth'

describe('clampListWidth', () => {
  it('takes the width dragged to while both halves have room', () => {
    expect(clampListWidth(500.4, 1400, true)).toBe(500)
  })

  it('stops the list at its floor', () => {
    expect(clampListWidth(100, 1400, true)).toBe(320)
    expect(clampListWidth(100, 900, false)).toBe(256)
  })

  it('leaves the reading pane room to read a message in', () => {
    expect(clampListWidth(1300, 1400, true)).toBe(1400 - 480)
    expect(clampListWidth(800, 900, false)).toBe(900 - 400)
  })

  it('keeps the list at its floor when the row is too narrow for both', () => {
    expect(clampListWidth(400, 500, true)).toBe(320)
  })
})
