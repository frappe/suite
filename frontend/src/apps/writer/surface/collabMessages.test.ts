import { describe, expect, it } from 'vitest'

import {
  bannerFor,
  notUpgradedBanner,
  openFailureFor,
  refusedSaveBanner,
  upgradingBanner,
  type Banner,
  type BannerState,
} from './collabMessages'

// What the banner reads on the page, with the link standing for its words
function pageText(banner: Banner | null) {
  if (!banner) {
    return banner
  }

  let link = ''
  if (banner.link) {
    link = `[${banner.link.label}]`
  }

  const after = banner.after ?? ''
  return `${banner.text}${link}${after}`
}

const defaultState = {
  blockReason: null,
  stopReason: null,
  holdReason: null,
  isRestoring: false,
  hasNewerSchema: false,
  canEdit: true,
  pauseReason: null,
  hasFailed: false,
  isAtLimit: false,
  isKeptOnDevice: true,
  isRecoveryKept: false,
  hasCopyFailed: false,
  setAside: null,
  removedWork: null,
  isNewerAfterReload: false,
  unsentCount: 1,
  isPolling: false,
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
    expect(bannerText({ blockReason: 'signed_out' })).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them.",
    )
    expect(bannerText({ blockReason: 'signed_out', isKeptOnDevice: false })).toBe(
      "You're signed out, so changes aren't saved. [Sign in] to save them. Keep this tab open.",
    )
  })

  it("doesn't speak of unsaved changes when nothing is unsent", () => {
    for (const isKeptOnDevice of [true, false]) {
      expect(bannerText({ blockReason: 'signed_out', isKeptOnDevice, unsentCount: 0 })).toBe(
        "You're signed out. [Sign in] to keep editing.",
      )
    }
  })

  it("says a locked document isn't saving", () => {
    expect(bannerText({ blockReason: 'locked' })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them.",
    )
    expect(bannerText({ blockReason: 'locked', isKeptOnDevice: false })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them. Keep this tab open.",
    )
  })

  it("pauses editing offline when the browser can't keep changes", () => {
    expect(bannerText({ blockReason: 'offline', isKeptOnDevice: false })).toBe(
      "You're offline and this browser can't keep changes, so editing is paused. Keep this tab open.",
    )
    expect(bannerText({ blockReason: 'offline', isKeptOnDevice: false, unsentCount: 0 })).toBe(
      "You're offline and this browser can't keep changes, so editing is paused.",
    )
  })

  it('asks for a reload after signing in again elsewhere', () => {
    expect(bannerText({ blockReason: 'stale_session' })).toBe(
      'You signed in again in another tab. Reload to keep saving.',
    )
    expect(
      bannerText({ blockReason: 'stale_session', isKeptOnDevice: false, isRecoveryKept: true }),
    ).toBe(
      'You signed in again in another tab. Unsent changes were kept as a recovery copy. Reload to keep saving.',
    )
  })

  it('names a recovery copy kept after the device write failed, on a device store too', () => {
    expect(
      bannerText({ blockReason: 'stale_session', hasCopyFailed: true, isRecoveryKept: true }),
    ).toBe(
      'You signed in again in another tab. Unsent changes were kept as a recovery copy. Reload to keep saving.',
    )
  })

  it('keeps a lost right in its own words once late typing fails the tab', () => {
    const failedLate = { hasFailed: true, stopReason: 'lost_access', hasCopyFailed: true }

    expect([
      bannerText({ blockReason: 'lost_edit', ...failedLate }),
      bannerText({ blockReason: 'lost_read', ...failedLate }),
    ]).toEqual([
      "You can no longer edit this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
      "You can no longer open this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
  })

  it('asks no one to keep a tab open for nothing unsent', () => {
    const nothingUnsent = { isKeptOnDevice: false, unsentCount: 0 }

    expect([
      bannerText({ blockReason: 'locked', ...nothingUnsent }),
      bannerText({ pauseReason: 'upload_refused', ...nothingUnsent }),
      bannerText({ holdReason: 'change', ...nothingUnsent }),
    ]).toEqual([
      "This document was locked, so changes aren't saved. Unlock it to save them.",
      "Your network is refusing uploads, so your latest changes aren't saved.",
      'This document is read-only while an admin checks it.',
    ])
  })

  it("tells whether another person's sign-in kept the unsent changes", () => {
    expect(bannerText({ blockReason: 'other_user' })).toBe(
      'Someone else is now signed in here. Your unsent changes are kept on this device.',
    )
    expect(bannerText({ blockReason: 'other_user', isKeptOnDevice: false })).toBe(
      'Someone else is now signed in here. Keep this tab open.',
    )
    expect(
      bannerText({ blockReason: 'other_user', isKeptOnDevice: false, isRecoveryKept: true }),
    ).toBe(
      'Someone else is now signed in here. Unsent changes were kept as a recovery copy. Reload to continue.',
    )
  })

  it('never claims a recovery copy the device could not write, and asks to keep the tab open', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'seq', hasCopyFailed: true })).toBe(
      "Saving stopped in this tab. Unsent changes couldn't be kept on this device, so keep this tab open.",
    )
    expect(bannerText({ blockReason: 'lost_edit', hasCopyFailed: true })).toBe(
      "You can no longer edit this document. Unsent changes couldn't be kept on this device, so keep this tab open.",
    )
  })

  it('asks a signed-out-elsewhere or stopped tab to stay open, with no Reload, while unsent work is kept nowhere', () => {
    const copyFailedNote = " Unsent changes couldn't be kept on this device, so keep this tab open."

    expect([
      bannerText({ blockReason: 'stale_session', isKeptOnDevice: false }),
      bannerText({ blockReason: 'stale_session', hasCopyFailed: true }),
      bannerText({ blockReason: 'other_user', hasCopyFailed: true }),
      bannerText({ hasFailed: true, isKeptOnDevice: false }),
      bannerText({ blockReason: 'stale_session', isKeptOnDevice: false, unsentCount: 0 }),
      bannerText({ blockReason: 'other_user', isKeptOnDevice: false, unsentCount: 0 }),
      bannerText({ hasFailed: true, isKeptOnDevice: false, unsentCount: 0 }),
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
    const failedWrite = { isKeptOnDevice: true, hasCopyFailed: true }

    expect([
      bannerText({ blockReason: 'other_user', ...failedWrite, unsentCount: 0 }),
      bannerText({ blockReason: 'stale_session', ...failedWrite, unsentCount: 0 }),
      bannerText({ hasFailed: true, ...failedWrite, unsentCount: 0 }),
    ]).toEqual([
      'Someone else is now signed in here. Reload to continue.',
      'You signed in again in another tab. Reload to keep saving.',
      'Saving stopped in this tab. Reload to keep editing.',
    ])
  })

  it('asks a tab still behind a newer Writer after a reload to stay open while unsent work is kept nowhere', () => {
    const afterReload = { hasNewerSchema: true, isNewerAfterReload: true }

    expect([
      bannerText({ ...afterReload, isKeptOnDevice: false }),
      bannerText({ ...afterReload, hasCopyFailed: true }),
      bannerText({ ...afterReload, isKeptOnDevice: false, isRecoveryKept: true }),
    ]).toEqual([
      'This document needs a newer version of Writer than this site has. Ask your admin. Keep this tab open.',
      "This document needs a newer version of Writer than this site has. Ask your admin. Unsent changes couldn't be kept on this device, so keep this tab open.",
      'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.',
    ])
  })

  it('asks to keep the tab open, and offers no Reload, wherever saving waits while unsent work is kept nowhere', () => {
    const blocks: BannerState['blockReason'][] = [
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
      { hasFailed: true },
      { hasFailed: true, stopReason: 'seq' },
      { hasFailed: true, stopReason: 'browser' },
      { hasNewerSchema: true },
      { hasNewerSchema: true, canEdit: false },
      { hasNewerSchema: true, isNewerAfterReload: true },
      { holdReason: 'change' },
      { pauseReason: 'upload_refused' },
    ]
    const conditions = [
      ...waits,
      {},
      { isRestoring: true },
      { isAtLimit: true },
      { isPolling: true },
    ]
    const keptNowhere: Partial<BannerState>[] = [{ isKeptOnDevice: false }, { hasCopyFailed: true }]
    const states = blocks.flatMap((blockReason) =>
      conditions.flatMap((condition) =>
        keptNowhere.flatMap((where) =>
          [false, true].map((isFrozen) => ({
            condition,
            changes: { ...condition, ...where, blockReason, isFrozen },
          })),
        ),
      ),
    )
    const misses = states.filter(({ condition, changes }) => {
      const text = bannerText(changes) ?? ''
      const isWaiting =
        changes.blockReason !== null || changes.isFrozen || waits.includes(condition)
      const isAsked = text.toLowerCase().includes('keep this tab open')
      const isReloadOffered =
        bannerFor({ ...defaultState, ...changes })?.canReload || text.includes('Reload')
      return isReloadOffered || (isWaiting && !isAsked)
    })

    expect(misses.map(({ changes }) => changes)).toEqual([])
  })

  it('names the recovery copy after a lost right or a stop', () => {
    expect(bannerText({ blockReason: 'lost_edit', isRecoveryKept: true })).toBe(
      'You can no longer edit this document. Unsent changes were kept as a recovery copy.',
    )
    expect(bannerText({ blockReason: 'lost_read' })).toBe('You can no longer open this document.')
    expect(bannerText({ hasFailed: true, isRecoveryKept: true })).toBe(
      'Saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })
})

describe('collab stop copy', () => {
  it('says why the server will never save a change', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'poison', isRecoveryKept: true })).toBe(
      "This document can't hold a change made in this tab, so saving stopped. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says a change too large to save should go in as files', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'too_large', isRecoveryKept: true })).toBe(
      'A change in this tab is too large to save. Insert large images as files. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says a change a full document refused could not be saved, and where it went', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'document_full', isRecoveryKept: true })).toBe(
      "This document is at its size limit, so a change in this tab couldn't be saved. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says saving stopped because a newer Writer edited the document, and where the unsent work went', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'schema', isRecoveryKept: true })).toBe(
      'This document was edited in a newer version of Writer, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says saving stopped because collaboration was switched off, and where the unsent work went', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'disabled', isRecoveryKept: true })).toBe(
      'Collaboration was switched off for this app, so saving stopped in this tab. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says a document at its size limit frees space as content is deleted, and where the latest changes went', () => {
    expect(bannerText({ isAtLimit: true })).toBe(
      'This document is at its size limit. Delete content to free space.',
    )
    expect(bannerText({ isAtLimit: true, setAside: 'document_full' })).toBe(
      'This document is at its size limit. Your latest changes went to a recovery copy. Delete content to free space.',
    )
  })

  it('says nothing while saving goes on, unless an earlier room set edits aside', () => {
    expect(bannerFor(defaultState)).toBeNull()
    expect(bannerText({ setAside: 'poison' })).toBe(
      "Your last edits couldn't be saved here and were kept as a recovery copy.",
    )
  })

  it("says someone else's edit removed text typed here, and whether this device kept it", () => {
    expect(bannerText({ removedWork: 'kept' })).toBe(
      "Someone else's edit removed text you typed. It was kept as a recovery copy.",
    )
    expect(bannerText({ removedWork: 'unkept', isPolling: true })).toBe(
      "Someone else's edit removed text you typed, and it couldn't be kept on this device.",
    )
  })

  it('says a restore stopped the work typed before it, and where it went', () => {
    expect(bannerText({ stopReason: 'restored', hasFailed: true, isRecoveryKept: true })).toBe(
      "A version of this document was restored, so changes made in this tab before it weren't saved. Unsent changes were kept as a recovery copy. Reload to keep editing.",
    )
  })

  it('says a tab out of step with the server stopped saving, and where the unsent work went', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'clock_gap', isRecoveryKept: true })).toBe(
      'This tab fell out of step with the server, so saving stopped. Unsent changes were kept as a recovery copy. Reload to keep editing.',
    )
  })

  it('says a network refusing uploads is holding the latest changes back, and where they are', () => {
    expect(bannerText({ pauseReason: 'upload_refused' })).toBe(
      "Your network is refusing uploads, so your latest changes aren't saved. They're kept on this device.",
    )
    expect(bannerText({ pauseReason: 'upload_refused', isKeptOnDevice: false })).toBe(
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
      bannerText({ ...frozen, hasFailed: true }),
      bannerText({ ...frozen, hasFailed: true, stopReason: 'browser' }),
      bannerText({ ...frozen, blockReason: 'locked' }),
      bannerText({ ...frozen, hasNewerSchema: true }),
      bannerText({ ...frozen, holdReason: 'change' }),
      bannerText({ ...frozen, isPolling: true }),
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
    const frozen = { isFrozen: true, hasFailed: true }

    expect([
      Boolean(bannerFor({ ...defaultState, ...frozen })?.canReload),
      Boolean(bannerFor({ ...defaultState, ...frozen, stopReason: 'browser' })?.canReload),
    ]).toEqual([true, false])
  })

  it('asks a frozen tab to stay open, with no Reload, while unsent work waits only in it', () => {
    const frozen = { ...defaultState, isFrozen: true, isKeptOnDevice: false }
    const keepOpen = {
      text: "Part of this document can't be shown here, so editing is paused to keep it safe. Keep this tab open.",
    }
    const reload = {
      text: "Part of this document can't be shown here, so editing is paused to keep it safe.",
      canReload: true,
    }

    expect([
      bannerFor({ ...frozen, holdReason: 'change' }),
      bannerFor({ ...frozen, pauseReason: 'upload_refused' }),
      bannerFor({ ...frozen, holdReason: 'change', isKeptOnDevice: true }),
      bannerFor({ ...frozen, holdReason: 'change', isRecoveryKept: true }),
      bannerFor({ ...frozen, holdReason: 'change', unsentCount: 0 }),
      bannerFor({ ...frozen, isPolling: true }),
      bannerFor({ ...frozen, isRestoring: true }),
      bannerFor({ ...frozen, isAtLimit: true }),
      bannerFor({ ...frozen, pauseReason: 'server' }),
      bannerFor({ ...frozen, isKeptOnDevice: true, hasCopyFailed: true }),
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
    const stopped = { ...defaultState, isFrozen: true, hasFailed: true }
    const frozenText = "Part of this document can't be shown here, so editing stays paused."

    expect([
      bannerFor({ ...stopped, hasCopyFailed: true }),
      bannerFor({ ...stopped, isKeptOnDevice: false }),
      bannerFor({ ...stopped, isKeptOnDevice: false, isRecoveryKept: true }),
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
      bannerText({ hasNewerSchema: true, isKeptOnDevice: false }),
      bannerText({ hasNewerSchema: true, hasCopyFailed: true }),
    ]).toEqual([
      'This document was edited in a newer version of Writer. Keep this tab open.',
      "This document was edited in a newer version of Writer. Unsent changes couldn't be kept on this device, so keep this tab open.",
    ])
    expect(bannerText({ hasNewerSchema: true, isKeptOnDevice: false, isRecoveryKept: true })).toBe(
      'This document was edited in a newer version of Writer. Reload to edit it.',
    )
  })

  it('does not offer a reload for a stop a reload would only repeat', () => {
    expect(bannerText({ hasFailed: true, stopReason: 'browser', isRecoveryKept: true })).toBe(
      "This document can't be edited in this browser version. Unsent changes were kept as a recovery copy.",
    )
  })

  it('says a held document is read-only while an admin checks it, and where the typing is', () => {
    expect(bannerText({ holdReason: 'change' })).toBe(
      "This document is read-only while an admin checks it. Your unsent changes are saved on this device and will be added once it's editable again.",
    )
    expect(bannerText({ holdReason: 'change', isKeptOnDevice: false })).toBe(
      "This document is read-only while an admin checks it. Your unsent changes will be added once it's editable again. Keep this tab open.",
    )
    expect(bannerText({ holdReason: 'change', unsentCount: 0 })).toBe(
      'This document is read-only while an admin checks it.',
    )
  })

  it('says editing waits while a version is restored', () => {
    expect(bannerText({ isRestoring: true, pauseReason: 'restoring' })).toBe(
      'Someone is restoring a version of this document. You can edit again once it is done.',
    )
  })

  it('says the same when the whole document is held as when one change is', () => {
    expect(bannerText({ holdReason: 'bad_checkpoint', unsentCount: 0 })).toBe(
      'This document is read-only while an admin checks it.',
    )
  })

  it('stops asking for a reload once a reload brought back the same Writer', () => {
    const fallback =
      'This document needs a newer version of Writer than this site has. Try again in a few minutes, or ask your admin.'
    expect([
      bannerText({ hasNewerSchema: true, isNewerAfterReload: true }),
      bannerText({
        hasNewerSchema: true,
        isNewerAfterReload: true,
        canEdit: false,
        unsentCount: 0,
      }),
    ]).toEqual([fallback, fallback])
  })

  it('asks for a reload when a newer Writer edited the document', () => {
    expect(bannerText({ hasNewerSchema: true })).toBe(
      'This document was edited in a newer version of Writer. Reload to edit it.',
    )
  })

  it('asks a reader to reload to see the changes, not to edit', () => {
    expect(bannerText({ hasNewerSchema: true, canEdit: false, unsentCount: 0 })).toBe(
      'This document was edited in a newer version of Writer. Reload to see its latest changes.',
    )
  })

  it('says live updates are unavailable while the tab polls, unless something says more', () => {
    expect(bannerText({ isPolling: true })).toBe(
      "Live updates are unavailable, so others' changes show up late.",
    )
    expect(bannerText({ isPolling: true, blockReason: 'locked' })).toBe(
      "This document was locked, so changes aren't saved. Unlock it to save them.",
    )
    expect(bannerText({ isPolling: true, isAtLimit: true })).toBe(
      'This document is at its size limit. Delete content to free space.',
    )
  })

  it('keeps the general copy for a stop it has no words for', () => {
    for (const stopReason of ['seq_conflict', 'constructor']) {
      expect(bannerText({ hasFailed: true, stopReason })).toBe(
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
    expect(openFailureFor('user_changed')).toBe(
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

describe('collab read-only copy for old documents', () => {
  it('says an old document is read-only until it is upgraded, and when its body was unreadable', () => {
    expect(pageText(upgradingBanner(null, false))).toBe(
      'This document is being upgraded for editing together. It is read-only until then.',
    )
    expect(pageText(upgradingBanner(null, true))).toBe(
      'This document is being upgraded for editing together. It is read-only until then.' +
        " Its saved body couldn't be read, so this is its last saved copy.",
    )
  })

  it('names why an old document waits when the server gives a reason', () => {
    expect(pageText(upgradingBanner('node', false))).toBe(
      'This document is being upgraded for editing together. It is read-only until then.' +
        ' Reason: the server has no Node 22.13 or newer.',
    )
    expect(pageText(upgradingBanner('scheduler', true))).toBe(
      'This document is being upgraded for editing together. It is read-only until then.' +
        ' Reason: the scheduler is off.' +
        " Its saved body couldn't be read, so this is its last saved copy.",
    )
    expect(pageText(upgradingBanner('no converter bundle', false))).toBe(
      'This document is being upgraded for editing together. It is read-only until then.' +
        ' Reason: no converter bundle.',
    )
  })

  it('says a refused document stays read-only, naming the reason only when one is given', () => {
    expect(pageText(notUpgradedBanner(null, false))).toBe(
      "This document couldn't be upgraded, so it stays read-only.",
    )
    expect(pageText(notUpgradedBanner('too_large', false))).toBe(
      "This document couldn't be upgraded, so it stays read-only. Reason: too_large.",
    )
    expect(pageText(notUpgradedBanner('too_large', true))).toBe(
      "This document couldn't be upgraded, so it stays read-only. Reason: too_large." +
        " Its saved body couldn't be read, so this is its last saved copy.",
    )
  })
})
