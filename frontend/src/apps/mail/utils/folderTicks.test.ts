import { describe, expect, it } from 'vitest'

import { folderTicks } from './folderTicks'

const filed = (...ids: string[]) => ({ mailboxes: ids.map((mailbox_id) => ({ mailbox_id })) })

describe('folderTicks', () => {
  it('ticks a folder a thread is in, though its replies are only in Sent', () => {
    const [inbox, cloud] = folderTicks([[filed('inbox'), filed('sent')]], ['inbox', 'cloud'])
    expect(inbox.ticked).toBe('all')
    expect(cloud.ticked).toBe('none')
  })

  it('half-ticks a folder only some of the threads are in', () => {
    const [cloud] = folderTicks([[filed('inbox', 'cloud')], [filed('inbox')]], ['cloud'])
    expect(cloud.ticked).toBe('some')
  })

  it('will not untick a folder that is some message’s only one', () => {
    const [inbox, cloud] = folderTicks(
      [[filed('inbox')], [filed('inbox', 'cloud')]],
      ['inbox', 'cloud'],
    )
    expect(inbox.removable).toBe(false)
    expect(cloud.removable).toBe(true)
  })
})
