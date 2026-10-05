import { describe, expect, it } from 'vitest'

import { meetingCodeFrom } from './meetingCode'

const origin = 'https://suite.example.com'

describe('joining a Meet room', () => {
  it.each([
    ' abcd-efgh-ijkl ',
    '/meet/abcd-efgh-ijkl',
    'https://suite.example.com/meet/abcd-efgh-ijkl?camera=off',
  ])('accepts a code or same-site room link: %s', (value) => {
    expect(meetingCodeFrom(value, origin)).toBe('abcd-efgh-ijkl')
  })

  it.each([
    '',
    'not-a-code',
    '/meet/scheduled',
    '/meet/recordings',
    'https://other.example.com/meet/abcd-efgh-ijkl',
    'javascript:alert(1)',
    '/files/abcd-efgh-ijkl',
    '/meet/abcd-efgh-ijkl/extra',
  ])('rejects an invalid or unrelated destination: %s', (value) => {
    expect(meetingCodeFrom(value, origin)).toBe('')
  })
})
