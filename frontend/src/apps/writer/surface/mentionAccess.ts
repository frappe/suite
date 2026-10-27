import { dialog, type ImperativeDialogAction } from 'frappe-ui'

import { peopleWithoutAccess, shareToView, type WriterUser } from '@/apps/writer/drive'
import { translate as __ } from '@/platform/translation'

import { mentionedIn } from './commentMentions'

interface MentionAccessOptions {
  /** Whether the writer may share the document, which needs Manage. */
  canShare: boolean
  /** The people the comment named before an edit; they were asked about already. */
  mentionedBefore?: readonly string[]
}

/**
 * Asks before a comment names people who can't open the document. Someone who
 * can share it may share it with them at View, then post. True means post.
 */
export async function confirmMentionAccess(
  node: string,
  text: string,
  { canShare, mentionedBefore = [] }: MentionAccessOptions,
): Promise<boolean> {
  const added = mentionedIn(text).filter((user) => !mentionedBefore.includes(user))
  const locked = added.length ? await peopleWithoutAccess(node, added) : []
  if (!locked.length) {
    return true
  }

  return new Promise((resolve) => {
    const share: ImperativeDialogAction = {
      label: __('Share and post'),
      variant: 'solid',
      onClick: async () => {
        await shareToView(
          node,
          locked.map((person) => person.name),
        )
        resolve(true)
      },
    }
    const post: ImperativeDialogAction = canShare
      ? { label: __('Post without sharing'), variant: 'outline' }
      : { label: __('Post anyway'), variant: 'solid' }
    dialog.confirm({
      title: lockedTitle(locked),
      message: canShare
        ? __('They will be notified but can’t open it. Share it with them so they can view it?')
        : __('They will be notified but can’t open it. Ask someone who manages it to share it.'),
      icon: 'lucide-lock',
      onCancel: () => resolve(false),
      actions: [
        { label: __('Cancel'), variant: 'outline', onClick: () => resolve(false) },
        { ...post, onClick: () => resolve(true) },
        ...(canShare ? [share] : []),
      ],
    })
  })
}

// Names up to three people, then counts them
function lockedTitle(locked: WriterUser[]) {
  if (locked.length > 3) {
    return __('{0} people can’t open this document', [String(locked.length)])
  }

  const names = new Intl.ListFormat(undefined, { type: 'conjunction' })
  return __('{0} can’t open this document', [names.format(locked.map((person) => person.label))])
}
