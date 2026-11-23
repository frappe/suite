import { describe, expect, it } from 'vitest'

import { getErrorMessage, refusalOr } from './error'

describe('getErrorMessage', () => {
  it('shows the message without an exception class prefix', () => {
    expect(
      getErrorMessage(
        new Error('ValidationError: Recording is not currently available for this meeting'),
      ),
    ).toBe('Recording is not currently available for this meeting')
  })

  it('preserves ordinary message labels', () => {
    expect(getErrorMessage(new Error('Microphone: access was denied'))).toBe(
      'Microphone: access was denied',
    )
  })

  it('removes backend HTML from user-facing errors', () => {
    expect(
      getErrorMessage(
        new Error('Login to access <strong>suite.meet.api.meeting.join_meeting</strong>.'),
      ),
    ).toBe('Login to access suite.meet.api.meeting.join_meeting.')
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
