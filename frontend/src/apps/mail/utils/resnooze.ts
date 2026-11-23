import { api, client } from '@/api'

export type Waited = { until: string; ids: string[] }

/** An Unsnooze undone: each conversation waits again for the time the Unsnooze said it was waiting
 * for, in one account's list and in All accounts'. */
export const resnooze = (account: string, waited: Waited[]) =>
  Promise.all(
    waited.map(({ until, ids }) =>
      client.mutation(api.mail.messages.snooze, { account, ids, until, leaves: null }),
    ),
  )
