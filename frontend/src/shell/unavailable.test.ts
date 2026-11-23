import { describe, expect, it } from 'vitest'

import { describeUnavailable } from '@/shell/unavailable'

describe('an area the account cannot use', () => {
  it.each(['Mail', 'Calendar'])(
    '%s tells a person without a mailbox on a site with mail to ask their admin',
    (area) => {
      expect(describeUnavailable(area, ['jmap'], true)).toEqual({
        title: `${area} is unavailable`,
        reason: "You don't have a Mail account.",
        nextStep: 'Ask your admin to add one.',
      })
    },
  )

  it('asks for mail to be set up on a site that has none', () => {
    const copy = describeUnavailable('Mail', ['jmap'], false)
    expect(copy.reason).toBe('This area needs a configured mail account.')
    expect(copy.nextStep).toBe('Ask a site administrator to configure mail, then reload this page.')
  })

  it('talks about access, not mail, when another capability is missing', () => {
    const copy = describeUnavailable('Admin', ['suiteAdmin'], true)
    expect(copy.reason).toBe('Your account does not have the capability required for this area.')
  })
})
