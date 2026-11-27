import { api, client } from '@/api'

export type Waited = { until: string; ids: string[] }

/** An Unsnooze undone: each conversation waits again for the time the Unsnooze said it was waiting
 * for, in one account's list and in All accounts'. `threads`, the long threads the list held in
 * part, are snoozed whole again where they all waited for one time; otherwise they are left out,
 * as a time a thread did not wait for would have its rest filed away under another's. */
export const resnooze = (account: string, waited: Waited[], threads: string[] = []) =>
  Promise.all(
    waited.map(({ until, ids }) =>
      client.mutation(api.mail.messages.snooze, {
        account,
        ids,
        until,
        leaves: null,
        threads: waited.length === 1 && threads.length ? threads : undefined,
      }),
    ),
  )
