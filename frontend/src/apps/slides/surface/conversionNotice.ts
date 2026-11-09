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
    if (!reason) {
      return refused
    }

    const line = reasonLine(reason)

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
