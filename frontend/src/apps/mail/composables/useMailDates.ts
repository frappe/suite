import { shallowRef } from 'vue'

type MailDates = typeof import('@/apps/mail/utils/mailDates')

// One load for the whole app, started by the first mail opened, so the parser stays out of the
// main bundle and out of every page that never shows a mail.
const loaded = shallowRef<MailDates | null | undefined>()
let loading: Promise<unknown> | undefined

const load = () =>
  (loading ??= import('@/apps/mail/utils/mailDates').then(
    (module) => (loaded.value = module),
    () => (loaded.value = null),
  ))

/**
 * The date reader for a mail's body: `undefined` while it loads, `null` if it could not load (the
 * mail then shows without its dates marked).
 */
export function useMailDates() {
  void load()
  return loaded
}

/** Resolves once the date reader has loaded, or failed to. Starts the load if nothing has. */
export async function mailDatesLoaded(): Promise<void> {
  await load()
}
