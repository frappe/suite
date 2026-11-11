import { translate } from '@/platform/translation'

export interface ConversionStatus {
  state: string
  reason?: string
}

// Why every old deck waits, as the server names it to System Managers
const WAIT_REASONS = new Map<string, () => string>(
  Object.entries({
    node: () => translate('the server has no Node 22.13 or newer'),
    scheduler: () => translate('the scheduler is off'),
  }),
)

// Why the converter refused a presentation; the server sends `code` or `code: detail`
const REFUSAL_REASONS = new Map<string, () => string>(
  Object.entries({
    check: () => translate("the upgraded version didn't match the original"),
    too_large: () => translate('it is too large to edit together'),
    'unreadable-yjs': () => translate("its saved changes couldn't be read"),
    over_quota: () => translate('there is no storage space left'),
    child_timeout: () => translate('the upgrade took too long'),
    child_crash: () => translate('the upgrade stopped unexpectedly'),
    bad_answer: () => translate('the upgrade gave an unreadable answer'),
    combined: () => translate('it is a combined presentation, with no slides of its own'),
  }),
)

/** Why the converter refused, in words, or null for a reason it doesn't name. `code` or `code: detail` */
export function refusalReason(reason: string | null | undefined): string | null {
  const [code] = (reason ?? '').split(':')
  const explain = REFUSAL_REASONS.get(code)
  if (!explain) {
    return null
  }

  return explain()
}

function reasonLine(reason: string) {
  return translate('Reason: {0}.', [reason])
}

function waitReason(reason: string) {
  const explain = WAIT_REASONS.get(reason)
  if (explain) return explain()

  return reason
}

// What a deck with no log yet tells its reader, as Writer's documents do. `reason` only reaches System Managers
export function conversionNotice({ state, reason }: ConversionStatus) {
  if (state === 'refused') {
    const refused = translate("This presentation couldn't be upgraded, so it stays read-only.")
    const explained = refusalReason(reason)
    if (!explained) {
      return refused
    }

    const line = reasonLine(explained)

    return `${refused} ${line}`
  }

  const waiting = translate(
    'This presentation is being upgraded for editing together. It is read-only until then.',
  )
  if (!reason) {
    return waiting
  }

  const line = reasonLine(waitReason(reason))

  return `${waiting} ${line}`
}
