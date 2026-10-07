import { describe, expect, it } from 'vitest'

import { bannerFor, openFailureFor, type Banner } from './collabMessages'

// What the banner reads on the page, with the link standing for its words
const read = (banner: Banner) =>
  `${banner.text}${banner.link ? `[${banner.link.label}]` : ''}${banner.after ?? ''}`
const standing = { blocked: null, stopped: null, onDevice: true, kept: false, unsent: 1 } as const

describe('collab banner copy', () => {
  it("says a signed-out tab isn't saving and asks to sign in", () => {
    expect(read(bannerFor({ ...standing, blocked: 'signed_out' }))).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them.",
    )
    expect(read(bannerFor({ ...standing, blocked: 'signed_out', onDevice: false }))).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them. Keep this tab open.",
    )
  })

  it("doesn't speak of unsaved changes when nothing is unsent", () => {
    for (const onDevice of [true, false]) {
      expect(read(bannerFor({ ...standing, blocked: 'signed_out', onDevice, unsent: 0 }))).toBe(
        "You're signed out. [Sign in] to keep editing.",
      )
    }
  })

  it("says a locked document isn't saving", () => {
    expect(read(bannerFor({ ...standing, blocked: 'locked' }))).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them.",
    )
    expect(read(bannerFor({ ...standing, blocked: 'locked', onDevice: false }))).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them. Keep this tab open.",
    )
  })

  it("pauses editing offline when the browser can't keep changes", () => {
    expect(read(bannerFor({ ...standing, blocked: 'offline', onDevice: false }))).toBe(
      "You're offline and this browser can't keep changes, so editing is paused.",
    )
  })

  it('asks for a reload after signing in again elsewhere', () => {
    expect(read(bannerFor({ ...standing, blocked: 'stale_session' }))).toBe(
      'You signed in again in another tab. Reload to keep saving.',
    )
    expect(
      read(bannerFor({ ...standing, blocked: 'stale_session', onDevice: false, kept: true })),
    ).toBe(
      'You signed in again in another tab. Unsent changes were kept as a recovery copy. Reload to keep saving.',
    )
  })

  it("tells whether another person's sign-in kept the unsent changes", () => {
    expect(read(bannerFor({ ...standing, blocked: 'other_user' }))).toBe(
      'Someone else is now signed in here. Your unsent changes are kept on this device.',
    )
    expect(read(bannerFor({ ...standing, blocked: 'other_user', onDevice: false }))).toBe(
      'Someone else is now signed in here. Reload to continue.',
    )
    expect(
      read(bannerFor({ ...standing, blocked: 'other_user', onDevice: false, kept: true })),
    ).toBe(
      'Someone else is now signed in here. Unsent changes were kept as a recovery copy. Reload to continue.',
    )
  })

  it('names the recovery copy after a lost right or a stop', () => {
    expect(read(bannerFor({ ...standing, blocked: 'lost_edit', kept: true }))).toBe(
      'You can no longer edit this document. Unsent changes were kept as a recovery copy.',
    )
    expect(read(bannerFor({ ...standing, blocked: 'lost_read' }))).toBe(
      'You can no longer open this document.',
    )
    expect(read(bannerFor({ ...standing, kept: true }))).toBe(
      'Saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })
})

describe('collab stop copy', () => {
  it('says why the server will never save a change', () => {
    expect(read(bannerFor({ ...standing, stopped: 'poison', kept: true }))).toBe(
      "This document can't hold a change made in this tab, so saving stopped. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('keeps the general copy for a stop it has no words for', () => {
    for (const stopped of ['seq_conflict', 'constructor'])
      expect(read(bannerFor({ ...standing, stopped }))).toBe(
        'Saving stopped in this tab. Reload to keep editing.',
      )
  })
})

describe('collab open failure copy', () => {
  it("says why the document didn't open and what to do", () => {
    expect(openFailureFor('signed_out')).toBe("You're signed out. Sign in to open this document.")
    expect(openFailureFor('locked')).toBe('This document is locked. Unlock it to open it.')
    expect(openFailureFor('stale_session')).toBe(
      'You signed in again in another tab. Reload to open this.',
    )
    expect(openFailureFor('principal_changed')).toBe(
      'Someone else is now signed in here. Reload to open this document.',
    )
  })

  it("names a failure the reply's status explains", () => {
    expect(openFailureFor(null, 0)).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    )
    expect(openFailureFor(null, 500)).toBe(
      'The server had a problem opening this document. Try again in a moment.',
    )
    expect(openFailureFor(null, 503)).toBe(
      'The server had a problem opening this document. Try again in a moment.',
    )
    expect(openFailureFor(null, 429)).toBe('The server is busy. Try again in a moment.')
    expect(openFailureFor(null, 400)).toBe("This document couldn't be opened.")
    expect(openFailureFor(null, null)).toBe("This document couldn't be opened.")
    expect(openFailureFor('locked', 500)).toBe('This document is locked. Unlock it to open it.')
  })
})
