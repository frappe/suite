import { peopleWithoutAccess, type WriterUser } from '@/apps/writer/drive'
import { confirm, toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

import { mentionedIn } from './commentMentions'

interface MentionAccessOptions {
  /** Whether the writer manages the document, so Drive shares it with the people they mention. */
  canShare: boolean
  /** The people the comment named before an edit; they were asked about already. */
  mentionedBefore?: readonly string[]
}

/**
 * Looks at the people a comment newly names who can't open the document. Drive enforces the rules
 * when the comment posts; this tells the writer. A blocked person is asked about first, and null
 * means the writer stopped. The function it answers says what the post did, once it has posted.
 */
export async function confirmMentionAccess(
  node: string,
  text: string,
  { canShare, mentionedBefore = [] }: MentionAccessOptions,
): Promise<(() => void) | null> {
  const added = mentionedIn(text).filter((user) => !mentionedBefore.includes(user))
  const locked = added.length ? await peopleWithoutAccess(node, added) : []
  const blocked = locked.filter((person) => person.is_blocked)
  if (blocked.length && !(await confirmBlocked(blocked))) {
    return null
  }

  const reached = locked.filter((person) => !person.is_blocked)
  return () => {
    if (!reached.length) return
    if (canShare) toast.success(__('{0} can now comment', [namesOf(reached)]))
    else {
      toast.warning(
        __('{0} can’t open this document until someone who manages it shares it', [
          namesOf(reached),
        ]),
      )
    }
  }
}

function confirmBlocked(blocked: WriterUser[]) {
  return confirm({
    title:
      blocked.length === 1
        ? __('{0} has been blocked from this document', [blocked[0].label])
        : __('{0} have been blocked from this document', [namesOf(blocked)]),
    message: __('The comment can still post, but they won’t be notified or get access.'),
    confirmLabel: __('Post anyway'),
  })
}

function namesOf(people: WriterUser[]) {
  const names = new Intl.ListFormat(undefined, { type: 'conjunction' })
  return names.format(people.map((person) => person.label))
}
