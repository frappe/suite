import { describe, expect, it } from 'vitest'

import { locationUrl } from '.'

describe('locationUrl', () => {
  it('opens a web address as written', () => {
    expect(locationUrl('https://us02web.zoom.us/j/854?pwd=BZ2r')).toBe(
      'https://us02web.zoom.us/j/854?pwd=BZ2r',
    )
  })

  it('gives an address written without a scheme the https it left out', () => {
    expect(locationUrl('zoom.us/j/854')).toBe('https://zoom.us/j/854')
  })

  it('leaves a place as a place', () => {
    expect(locationUrl('Neelkanth Corporate Park, Vidyavihar West, Mumbai')).toBeNull()
    expect(locationUrl('Room 4')).toBeNull()
    expect(locationUrl('')).toBeNull()
  })

  it('never opens a script', () => {
    expect(locationUrl('javascript:alert(1)')).toBeNull()
  })
})
