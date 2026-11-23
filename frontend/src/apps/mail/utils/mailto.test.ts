import { describe, expect, it } from 'vitest'

import { parseMailto } from './mailto'

describe('parseMailto', () => {
  it('reads the address out of a bare link', () => {
    expect(parseMailto('mailto:sagar@example.com')).toMatchObject({
      to: [{ email: 'sagar@example.com' }],
      cc: [],
      bcc: [],
    })
  })

  it('ignores anything that is not a mailto link', () => {
    expect(parseMailto('https://example.com')).toBeNull()
    expect(parseMailto('')).toBeNull()
  })

  it('takes every recipient, from the path and the headers', () => {
    const draft = parseMailto('mailto:a@x.com,b@x.com?to=c@x.com&cc=d@x.com&bcc=e@x.com')

    expect(draft?.to).toEqual([{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }])
    expect(draft?.cc).toEqual([{ email: 'd@x.com' }])
    expect(draft?.bcc).toEqual([{ email: 'e@x.com' }])
  })

  it('leaves a plus-addressed recipient intact', () => {
    // The trap here is URLSearchParams, which would read the `+` as a space.
    expect(parseMailto('mailto:user+tag@example.com')?.to).toEqual([
      { email: 'user+tag@example.com' },
    ])
    expect(parseMailto('mailto:?to=user%2Btag@example.com')?.to).toEqual([
      { email: 'user+tag@example.com' },
    ])
  })

  it('carries subject and body', () => {
    const draft = parseMailto('mailto:a@x.com?subject=Hello%20there&body=Line%20one%0ALine%20two')

    expect(draft?.subject).toBe('Hello there')
    expect(draft?.html_body).toBe('<div>Line one</div><div>Line two</div>')
  })

  it('keeps a blank line in the body', () => {
    expect(parseMailto('mailto:a@x.com?body=one%0A%0Atwo')?.html_body).toBe(
      '<div>one</div><div><br></div><div>two</div>',
    )
  })

  it('escapes markup in the body rather than injecting it into the draft', () => {
    expect(
      parseMailto('mailto:a@x.com?body=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E')?.html_body,
    ).toBe('<div>&lt;img src=x onerror=alert(1)&gt;</div>')
  })

  it('lets the first of a repeated header win', () => {
    expect(parseMailto('mailto:?to=a@x.com&to=b@x.com')?.to).toEqual([{ email: 'a@x.com' }])
  })

  it('survives a malformed escape', () => {
    expect(parseMailto('mailto:a@x.com?subject=100%')?.subject).toBe('100%')
  })

  it('opens an empty draft for a link with no address', () => {
    expect(parseMailto('mailto:')).toMatchObject({ to: [], cc: [], bcc: [] })
  })
})
