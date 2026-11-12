// Where threads are filed, as the ticks of a folder menu. A thread can sit in several folders at
// once, so one list of boxes says where it is and changes it, instead of separate Add To and Remove
// From menus that each showed only half of it.

interface Filed {
  mailboxes: { mailbox_id: string }[]
}

export interface FolderTick {
  id: string
  /** Every thread in it, some of them, or none. */
  ticked: 'all' | 'some' | 'none'
  /** Whether it can be unticked: taking a message out of its only folder would leave it nowhere. */
  removable: boolean
}

const isIn = (mail: Filed, id: string) => mail.mailboxes.some((m) => m.mailbox_id === id)

/**
 * The ticks for `threads`, each given as its messages. A thread is in a folder while any of its
 * messages is, as a conversation is read: one you have answered has its replies in Sent, not the
 * Inbox, and asking for all of them left the Inbox half-ticked on every thread you had replied to.
 */
export const folderTicks = (threads: Filed[][], folders: string[]): FolderTick[] =>
  folders.map((id) => {
    const filed = threads.filter((mails) => mails.some((mail) => isIn(mail, id))).length
    return {
      id,
      ticked: !filed ? 'none' : filed === threads.length ? 'all' : 'some',
      removable: threads.flat().every((mail) => !isIn(mail, id) || mail.mailboxes.length > 1),
    }
  })
