import type { RestoreResult, VersionRestored } from '@/platform/collab'
import { fullName, lookUp } from '@/platform/collab/names'
import { dayOrTime, versionTime } from '@/platform/collab/versionDates'
import { translate as __ } from '@/platform/translation'

/** What an app calls the file a message is about. */
export type FileNoun = 'document' | 'presentation'

/** What the person is told after a restore: whether the file is the version now, and how it went. */
export interface RestoreNotice {
  isRestored: boolean
  message: string
  /** The converter refused an old version, so the person is offered its download instead. */
  canDownload?: boolean
}

// The server's wait between restores, for a refusal that doesn't say how long is left
const RESTORE_EVERY_SECONDS = 60

// Whole sentences per noun, so each translates as one
const LINES = {
  document: {
    notKept: () =>
      __("The document as it is now couldn't be kept as a version first, so nothing was restored."),
    unchanged: () => __('The document already matches this version.'),
    openOne: (name: string) =>
      __('{0} has this document open now and will be told you restored it.', [name]),
    openMany: (names: string) =>
      __('{0} have this document open now and will be told you restored it.', [names]),
    restoredEarlier: (who: string) =>
      __('{0} restored an earlier version of this document.', [who]),
  },
  presentation: {
    notKept: () =>
      __(
        "The presentation as it is now couldn't be kept as a version first, so nothing was restored.",
      ),
    unchanged: () => __('The presentation already matches this version.'),
    openOne: (name: string) =>
      __('{0} has this presentation open now and will be told you restored it.', [name]),
    openMany: (names: string) =>
      __('{0} have this presentation open now and will be told you restored it.', [names]),
    restoredEarlier: (who: string) =>
      __('{0} restored an earlier version of this presentation.', [who]),
  },
}

// Functions, so each message is translated once the catalog has loaded
const REFUSALS = new Map<string, (noun: FileNoun) => string>(
  Object.entries({
    restoring: () => __('Someone else is restoring a version. Try again once it is done.'),
    behind: () => __('This tab is still catching up. Try again in a moment.'),
    milestone_failed: (noun: FileNoun) => LINES[noun].notKept(),
    paused: () => __('Saving is paused, so nothing was restored.'),
  }),
)

/** What the person is told when the converter refused an old version, with its reason if it gave one. */
export function refusedNotice(reason: string | null): RestoreNotice {
  let message = __(
    "This version couldn't be upgraded, so it can't be restored. You can download it.",
  )
  if (reason) {
    message += ' ' + __('Reason: {0}.', [reason])
  }

  return { isRestored: false, message, canDownload: true }
}

/** What the person is told about the room's answer to a restore. */
export function noticeFor(result: RestoreResult, noun: FileNoun): RestoreNotice {
  if (result.outcome === 'landed') {
    return { isRestored: true, message: __('Version restored') }
  }

  if (result.outcome === 'unchanged') {
    return { isRestored: true, message: LINES[noun].unchanged() }
  }

  if (result.outcome === 'unsent') {
    return {
      isRestored: false,
      message: __('Your changes are still saving. Try again in a moment.'),
    }
  }

  if (result.refusal === 'restore_recent') {
    const wait = result.retryS ?? RESTORE_EVERY_SECONDS
    return {
      isRestored: false,
      message: __('A restore just ran. Try again in {0} seconds.', [wait]),
    }
  }

  const refusal = result.refusal ?? ''
  const explain = REFUSALS.get(refusal)
  if (explain) return { isRestored: false, message: explain(noun) }

  return { isRestored: false, message: __('The version was not restored.') }
}

/**
 * Warns before a restore that changes the file under other people: who has it open now.
 * Empty when nobody else does.
 */
export function othersPresentWarning(
  people: { id: string; name: string }[],
  me: string,
  noun: FileNoun,
) {
  const others = people.filter((person) => person.id !== me)
  const names = [...new Set(others.map((person) => person.name))]
  if (!names.length) {
    return ''
  }

  const listed = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(names)
  if (names.length === 1) {
    return LINES[noun].openOne(listed)
  }

  return LINES[noun].openMany(listed)
}

/** What this person is told when someone else restores a version: who did, and which version. */
export async function restoredByOther({ by, version }: VersionRestored, noun: FileNoun) {
  if (by) {
    await lookUp(by)
  }

  const who = by ? fullName(by) : __('Someone')
  if (!version) {
    return LINES[noun].restoredEarlier(who)
  }

  if (version.label) {
    return __('{0} restored the version “{1}”.', [who, version.label])
  }

  const taken = { creation: version.takenAt }
  const day = dayOrTime(taken)
  const time = versionTime(taken)
  const when = day === time ? time : `${day}, ${time}`
  return __('{0} restored the version from {1}.', [who, when])
}
