interface Row {
  mailboxes: { mailbox_id: string }[]
}

// The folder a conversation is opened in: the first of `preferred` the message sits in, else
// whichever folder it does sit in.
export const homeMailbox = (row: Row, preferred: string[]): string | undefined => {
  const ids = row.mailboxes.map((mailbox) => mailbox.mailbox_id)
  return preferred.find((id) => id && ids.includes(id)) ?? ids[0]
}
