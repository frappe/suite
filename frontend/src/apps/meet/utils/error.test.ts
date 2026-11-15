import { describe, expect, it } from 'vitest'

import { getErrorMessage, hasServerMessages, refusalOr } from './error'

describe('getErrorMessage', () => {
  it('removes backend HTML from user-facing errors', () => {
    expect(
      getErrorMessage(
        new Error('Login to access <strong>suite.meet.api.meeting.join_meeting</strong>.'),
      ),
    ).toBe('Login to access suite.meet.api.meeting.join_meeting.')
  })
})

describe('hasServerMessages', () => {
  it('tells a refusal the server wrote apart from a network or browser failure', () => {
    const refusal = Object.assign(new Error('PermissionError'), {
      messages: ['Guests are not allowed in this meeting'],
    })
    expect(hasServerMessages(refusal)).toBe(true)
    expect(getErrorMessage(refusal)).toBe('Guests are not allowed in this meeting')
    expect(hasServerMessages(new TypeError('Failed to fetch'))).toBe(false)
    expect(hasServerMessages(Object.assign(new Error('x'), { messages: [] }))).toBe(false)
  })
})

describe('refusalOr', () => {
  it("shows the server's refusal, and the fallback for anything else", () => {
    const refusal = Object.assign(new Error('PermissionError'), {
      messages: ['Only the meeting host or co-host can manage recording'],
    })
    expect(refusalOr(refusal, 'Could not start recording')).toBe(
      'Only the meeting host or co-host can manage recording',
    )
    expect(refusalOr(new TypeError('Failed to fetch'), 'Could not start recording')).toBe(
      'Could not start recording',
    )
  })
})
