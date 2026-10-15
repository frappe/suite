import { describe, expect, it } from 'vitest'

import {
  bannerFor,
  openFailureFor,
  refusedSaveBanner,
  type Banner,
  type BannerState,
} from './collabMessages'

// What the banner reads on the page, with the link standing for its words
function pageText(banner: Banner | null) {
  if (!banner) return banner

  const link = banner.link ? `[${banner.link.label}]` : ''
  return `${banner.text}${link}${banner.after ?? ''}`
}

const defaultState = {
  blocked: null,
  stopped: null,
  held: null,
  restoring: false,
  newerSchema: false,
  canEdit: true,
  paused: null,
  failed: false,
  atLimit: false,
  onDevice: true,
  recoveryKept: false,
  copyFailed: false,
  setAside: null,
  isNewerAfterReload: false,
  unsent: 1,
  polling: false,
  isFrozen: false,
} as const

// What the banner reads for a room that differs from the default state in `changes`
function bannerText(changes: Partial<BannerState>) {
  const changed = { ...defaultState, ...changes }
  const banner = bannerFor(changed)
  return pageText(banner)
}

describe('collab banner copy', () => {
  it('tells an old editor its save was refused, where its work went, and to reload', () => {
    expect([refusedSaveBanner(true).text, refusedSaveBanner(false).text]).toEqual([
      'This document now saves as you edit, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
      'This document now saves as you edit, so saving stopped in this tab. Reload to keep editing.',
    ])
  })

  it("says a signed-out tab isn't saving and asks to sign in", () => {
    expect(bannerText({ blocked: 'signed_out' })).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them.",
    )
    expect(bannerText({ blocked: 'signed_out', onDevice: false })).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them. Keep this tab open.",
    )
  })

  it("doesn't speak of unsaved changes when nothing is unsent", () => {
    for (const onDevice of [true, false]) {
      expect(bannerText({ blocked: 'signed_out', onDevice, unsent: 0 })).toBe(
        "You're signed out. [Sign in] to keep editing.",
      )
    }
  })

  it("says a locked document isn't saving", () => {
    expect(bannerText({ blocked: 'locked' })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them.",
    )
    expect(bannerText({ blocked: 'locked', onDevice: false })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them. Keep this tab open.",
    )
  })

  it("pauses editing offline when the browser can't keep changes", () => {
    expect(bannerText({ blocked: 'offline', onDevice: false })).toBe(
      "You're offline and this browser can't keep changes, so editing is paused. Keep this tab open.",
    )
    expect(bannerText({ blocked: 'offline', onDevice: false, unsent: 0 })).toBe(
      "You're offline and this browser can't keep changes, so editing is paused.",
    )
  })

  it('asks for a reload after signing in again elsewhere', () => {
    expect(bannerText({ blocked: 'stale_session' })).toBe(
      'You signed in again in another tab. Reload to keep saving.',
    )
    expect(bannerText({ blocked: 'stale_session', onDevice: false, recoveryKept: true })).toBe(
      'You signed in again in another tab. Unsent changes were kept as a recovery copy. Reload to keep saving.',
    )
  })

  it('names a recovery copy kept after the device write failed, on a device store too', () => {
    expect(bannerText({ blocked: 'stale_session', copyFailed: true, recoveryKept: true })).toBe(
      'You signed in again in another tab. Unsent changes were kept as a recovery copy. Reload to keep saving.',
    )
  })

  it('keeps a lost right in its own words once late typing fails the tab', () => {
    const failedLate = { failed: true, stopped: 'lost_access', copyFailed: true }

    expect([
      bannerText({ blocked: 'lost_edit', ...failedLate }),
      bannerText({ blocked: 'lost_read', ...failedLate }),
    ]).toEqual([
      "You can no longer edit this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
      "You can no longer open this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
  })

  it('asks no one to keep a tab open for nothing unsent', () => {
    const nothingUnsent = { onDevice: false, unsent: 0 }

    expect([
      bannerText({ blocked: 'locked', ...nothingUnsent }),
      bannerText({ paused: 'upload_refused', ...nothingUnsent }),
      bannerText({ held: 'change', ...nothingUnsent }),
    ]).toEqual([
      "This document was locked, so changes aren't saved. Unlock it to save them.",
      "Your network is refusing uploads, so your latest changes aren't saved.",
      'This document is read-only while an admin checks it.',
    ])
  })

  it("tells whether another person's sign-in kept the unsent changes", () => {
    expect(bannerText({ blocked: 'other_user' })).toBe(
      'Someone else is now signed in here. Your unsent changes are kept on this device.',
    )
    expect(bannerText({ blocked: 'other_user', onDevice: false })).toBe(
      'Someone else is now signed in here. Keep this tab open.',
    )
    expect(bannerText({ blocked: 'other_user', onDevice: false, recoveryKept: true })).toBe(
      'Someone else is now signed in here. Unsent changes were kept as a recovery copy. Reload to continue.',
    )
  })

  it('never claims a recovery copy the device could not write, and asks to keep the tab open', () => {
    expect(bannerText({ failed: true, stopped: 'seq', copyFailed: true })).toBe(
      "Saving stopped in this tab. Unsent changes couldn't be kept on this device, so keep this tab open.",
    )
    expect(bannerText({ blocked: 'lost_edit', copyFailed: true })).toBe(
      "You can no longer edit this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    )
  })

  it('asks a signed-out-elsewhere or stopped tab to stay open, with no Reload, while unsent work is kept nowhere', () => {
    const copyFailedNote = " Unsent changes couldn't be kept on this device, so keep this tab open."

    expect([
      bannerText({ blocked: 'stale_session', onDevice: false }),
      bannerText({ blocked: 'stale_session', copyFailed: true }),
      bannerText({ blocked: 'other_user', copyFailed: true }),
      bannerText({ failed: true, onDevice: false }),
      bannerText({ blocked: 'stale_session', onDevice: false, unsent: 0 }),
      bannerText({ blocked: 'other_user', onDevice: false, unsent: 0 }),
      bannerText({ failed: true, onDevice: false, unsent: 0 }),
    ]).toEqual([
      'You signed in again in another tab. Keep this tab open.',
      `You signed in again in another tab.${copyFailedNote}`,
      `Someone else is now signed in here.${copyFailedNote}`,
      'Saving stopped in this tab. Keep this tab open.',
      'You signed in again in another tab. Reload to keep saving.',
      'Someone else is now signed in here. Reload to continue.',
      'Saving stopped in this tab. Reload to keep editing.',
    ])
  })

  it('never claims the failed device write kept the work, nor asks to stay open beside a Reload', () => {
    const failedWrite = { onDevice: true, copyFailed: true }

    expect([
      bannerText({ blocked: 'other_user', ...failedWrite, unsent: 0 }),
      bannerText({ blocked: 'stale_session', ...failedWrite, unsent: 0 }),
      bannerText({ failed: true, ...failedWrite, unsent: 0 }),
    ]).toEqual([
      'Someone else is now signed in here. Reload to continue.',
      'You signed in again in another tab. Reload to keep saving.',
      'Saving stopped in this tab. Reload to keep editing.',
    ])
  })

  it('asks a tab still behind a newer Writer after a reload to stay open while unsent work is kept nowhere', () => {
    const afterReload = { newerSchema: true, isNewerAfterReload: true }

    expect([
      bannerText({ ...afterReload, onDevice: false }),
      bannerText({ ...afterReload, copyFailed: true }),
      bannerText({ ...afterReload, onDevice: false, recoveryKept: true }),
    ]).toEqual([
      'This document needs a newer version of Writer than this site has. Ask your admin. Keep this tab open.',
      "This document needs a newer version of Writer than this site has. Ask your admin. Unsent changes couldn't be kept on this device, so keep this tab open.",
      'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.',
    ])
  })

  it('asks to keep the tab open, and offers no Reload, wherever saving waits while unsent work is kept nowhere', () => {
    const blocks: BannerState['blocked'][] = [
      null,
      'signed_out',
      'locked',
      'offline',
      'stale_session',
      'other_user',
      'lost_edit',
      'lost_read',
    ]
    const waits: Partial<BannerState>[] = [
      { failed: true },
      { failed: true, stopped: 'seq' },
      { failed: true, stopped: 'browser' },
      { newerSchema: true },
      { newerSchema: true, canEdit: false },
      { newerSchema: true, isNewerAfterReload: true },
      { held: 'change' },
      { paused: 'upload_refused' },
    ]
    const conditions = [...waits, {}, { restoring: true }, { atLimit: true }, { polling: true }]
    const keptNowhere: Partial<BannerState>[] = [{ onDevice: false }, { copyFailed: true }]
    const states = blocks.flatMap((blocked) =>
      conditions.flatMap((condition) =>
        keptNowhere.flatMap((where) =>
          [false, true].map((isFrozen) => ({
            condition,
            changes: { ...condition, ...where, blocked, isFrozen },
          })),
        ),
      ),
    )
    const misses = states.filter(({ condition, changes }) => {
      const text = bannerText(changes) ?? ''
      const isWaiting = changes.blocked !== null || changes.isFrozen || waits.includes(condition)
      const isAsked = text.toLowerCase().includes('keep this tab open')
      const isReloadOffered =
        bannerFor({ ...defaultState, ...changes })?.canReload || text.includes('Reload')
      return isReloadOffered || (isWaiting && !isAsked)
    })

    expect(misses.map(({ changes }) => changes)).toEqual([])
  })

  it('names the recovery copy after a lost right or a stop', () => {
    expect(bannerText({ blocked: 'lost_edit', recoveryKept: true })).toBe(
      'You can no longer edit this document. Unsent changes were kept as a recovery copy.',
    )
    expect(bannerText({ blocked: 'lost_read' })).toBe('You can no longer open this document.')
    expect(bannerText({ failed: true, recoveryKept: true })).toBe(
      'Saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })
})

describe('collab stop copy', () => {
  it('says why the server will never save a change', () => {
    expect(bannerText({ failed: true, stopped: 'poison', recoveryKept: true })).toBe(
      "This document can't hold a change made in this tab, so saving stopped. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says a change too large to save should go in as files', () => {
    expect(bannerText({ failed: true, stopped: 'too_large', recoveryKept: true })).toBe(
      'A change in this tab is too large to save. Insert large images as files. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says a change a full document refused could not be saved, and where it went', () => {
    expect(bannerText({ failed: true, stopped: 'document_full', recoveryKept: true })).toBe(
      "This document is at its size limit, so a change in this tab couldn't be saved. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says saving stopped because a newer Writer edited the document, and where the unsent work went', () => {
    expect(bannerText({ failed: true, stopped: 'schema', recoveryKept: true })).toBe(
      'This document was edited in a newer version of Writer, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says saving stopped because collaboration was switched off, and where the unsent work went', () => {
    expect(bannerText({ failed: true, stopped: 'disabled', recoveryKept: true })).toBe(
      'Collaboration was switched off for this app, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says a document at its size limit frees space as content is deleted, and where the latest changes went', () => {
    expect(bannerText({ atLimit: true })).toBe(
      'This document is at its size limit. Delete content to free space.',
    )
    expect(bannerText({ atLimit: true, setAside: 'document_full' })).toBe(
      'This document is at its size limit. Your latest changes went to a recovery copy. Delete content to free space.',
    )
  })

  it('says nothing while saving goes on, unless an earlier room set edits aside', () => {
    expect(bannerFor(defaultState)).toBeNull()
    expect(bannerText({ setAside: 'poison' })).toBe(
      "Your last edits couldn't be saved here and were kept as a recovery copy.",
    )
  })

  it('says a restore stopped the work typed before it, and where it went', () => {
    expect(bannerText({ stopped: 'restored', failed: true, recoveryKept: true })).toBe(
      "A version of this document was restored, so changes made in this tab before it weren't saved. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says a network refusing uploads is holding the latest changes back, and where they are', () => {
    expect(bannerText({ paused: 'upload_refused' })).toBe(
      "Your network is refusing uploads, so your latest changes aren't saved. They're kept on this device.",
    )
    expect(bannerText({ paused: 'upload_refused', onDevice: false })).toBe(
      "Your network is refusing uploads, so your latest changes aren't saved. Keep this tab open.",
    )
  })

  it('says editing is paused to keep a document safe that this tab cannot show, and offers Reload', () => {
    const banner = bannerFor({ ...defaultState, isFrozen: true })

    expect([banner?.text, banner?.canReload]).toEqual([
      "Part of this document can't be shown here, so editing is paused to keep it safe.",
      true,
    ])
  })

  it('shows a stop over a tab that cannot show the document, and the freeze over a wait', () => {
    const frozen = { isFrozen: true }
    const frozenText =
      "Part of this document can't be shown here, so editing is paused to keep it safe."

    expect([
      bannerText({ ...frozen, failed: true }),
      bannerText({ ...frozen, failed: true, stopped: 'browser' }),
      bannerText({ ...frozen, blocked: 'locked' }),
      bannerText({ ...frozen, newerSchema: true }),
      bannerText({ ...frozen, held: 'change' }),
      bannerText({ ...frozen, polling: true }),
    ]).toEqual([
      "Saving stopped in this tab. Part of this document can't be shown here, so editing stays paused. Reload to try saving again.",
      "This document can't be edited in this browser version. Part of this document can't be shown here, so editing stays paused.",
      "This document was locked, so changes aren't saved. Unlock it to save them.",
      'This document was edited in a newer version of Writer. Reload to edit it.',
      frozenText,
      frozenText,
    ])
  })

  it('offers Reload on a stop over a frozen tab only when the text asks for one', () => {
    const frozen = { isFrozen: true, failed: true }

    expect([
      Boolean(bannerFor({ ...defaultState, ...frozen })?.canReload),
      Boolean(bannerFor({ ...defaultState, ...frozen, stopped: 'browser' })?.canReload),
    ]).toEqual([true, false])
  })

  it('asks a frozen tab to stay open, with no Reload, while unsent work waits only in it', () => {
    const frozen = { ...defaultState, isFrozen: true, onDevice: false }
    const keepOpen = {
      text: "Part of this document can't be shown here, so editing is paused to keep it safe. Keep this tab open.",
    }
    const reload = {
      text: "Part of this document can't be shown here, so editing is paused to keep it safe.",
      canReload: true,
    }

    expect([
      bannerFor({ ...frozen, held: 'change' }),
      bannerFor({ ...frozen, paused: 'upload_refused' }),
      bannerFor({ ...frozen, held: 'change', onDevice: true }),
      bannerFor({ ...frozen, held: 'change', recoveryKept: true }),
      bannerFor({ ...frozen, held: 'change', unsent: 0 }),
      bannerFor({ ...frozen, polling: true }),
      bannerFor({ ...frozen, restoring: true }),
      bannerFor({ ...frozen, atLimit: true }),
      bannerFor({ ...frozen, paused: 'server' }),
      bannerFor({ ...frozen, onDevice: true, copyFailed: true }),
    ]).toEqual([
      keepOpen,
      keepOpen,
      reload,
      reload,
      reload,
      keepOpen,
      keepOpen,
      keepOpen,
      keepOpen,
      {
        text: "Part of this document can't be shown here, so editing is paused to keep it safe. Unsent changes couldn't be kept on this device, so keep this tab open.",
      },
    ])
  })

  it('asks a stopped frozen tab to stay open, with no Reload, while unsent work is kept nowhere', () => {
    const stopped = { ...defaultState, isFrozen: true, failed: true }
    const frozenText = "Part of this document can't be shown here, so editing stays paused."

    expect([
      bannerFor({ ...stopped, copyFailed: true }),
      bannerFor({ ...stopped, onDevice: false }),
      bannerFor({ ...stopped, onDevice: false, recoveryKept: true }),
    ]).toEqual([
      {
        text: `Saving stopped in this tab. ${frozenText} Unsent changes couldn't be kept on this device, so keep this tab open.`,
      },
      { text: `Saving stopped in this tab. ${frozenText} Keep this tab open.` },
      {
        text: `Saving stopped in this tab. Unsent changes were kept as a recovery copy. ${frozenText} Reload to try saving again.`,
        canReload: true,
      },
    ])
  })

  it('asks a tab behind a newer Writer to stay open while unsent work is kept nowhere', () => {
    expect([
      bannerText({ newerSchema: true, onDevice: false }),
      bannerText({ newerSchema: true, copyFailed: true }),
    ]).toEqual([
      'This document was edited in a newer version of Writer. Keep this tab open.',
      "This document was edited in a newer version of Writer. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
    expect(bannerText({ newerSchema: true, onDevice: false, recoveryKept: true })).toBe(
      'This document was edited in a newer version of Writer. Reload to edit it.',
    )
  })

  it('does not offer a reload for a stop a reload would only repeat', () => {
    expect(bannerText({ failed: true, stopped: 'browser', recoveryKept: true })).toBe(
      "This document can't be edited in this browser version. Unsent changes were kept as a recovery copy.",
    )
  })

  it('says a held document is read-only while an admin checks it, and where the typing is', () => {
    expect(bannerText({ held: 'change' })).toBe(
      "This document is read-only while an admin checks it. Your unsent changes are saved on this device and will be added once it's editable again.",
    )
    expect(bannerText({ held: 'change', onDevice: false })).toBe(
      "This document is read-only while an admin checks it. Your unsent changes will be added once it's editable again. Keep this tab open.",
    )
    expect(bannerText({ held: 'change', unsent: 0 })).toBe(
      'This document is read-only while an admin checks it.',
    )
  })

  it('says editing waits while a version is restored', () => {
    expect(bannerText({ restoring: true, paused: 'restoring' })).toBe(
      'Someone is restoring a version of this document. You can edit again once it is done.',
    )
  })

  it('says the same when the whole document is held as when one change is', () => {
    expect(bannerText({ held: 'bad_checkpoint', unsent: 0 })).toBe(
      'This document is read-only while an admin checks it.',
    )
  })

  it('stops asking for a reload once a reload brought back the same Writer', () => {
    const fallback =
      'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.'
    expect([
      bannerText({ newerSchema: true, isNewerAfterReload: true }),
      bannerText({ newerSchema: true, isNewerAfterReload: true, canEdit: false, unsent: 0 }),
    ]).toEqual([fallback, fallback])
  })

  it('asks for a reload when a newer Writer edited the document', () => {
    expect(bannerText({ newerSchema: true })).toBe(
      'This document was edited in a newer version of Writer. Reload to edit it.',
    )
  })

  it('asks a reader to reload to see the changes, not to edit', () => {
    expect(bannerText({ newerSchema: true, canEdit: false, unsent: 0 })).toBe(
      'This document was edited in a newer version of Writer. Reload to see its latest changes.',
    )
  })

  it('says live updates are unavailable while the tab polls, unless something says more', () => {
    expect(bannerText({ polling: true })).toBe(
      "Live updates are unavailable, so others' changes show up late.",
    )
    expect(bannerText({ polling: true, blocked: 'locked' })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them.",
    )
    expect(bannerText({ polling: true, atLimit: true })).toBe(
      'This document is at its size limit. Delete content to free space.',
    )
  })

  it('keeps the general copy for a stop it has no words for', () => {
    for (const stopped of ['seq_conflict', 'constructor']) {
      expect(bannerText({ failed: true, stopped })).toBe(
        'Saving stopped in this tab. Reload to keep editing.',
      )
    }
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
