import { api, client } from '@/api'
import { tabName, type InboxCategory } from '@/apps/mail/composables/useInboxTabs'
import { raiseOptimisticToast, raiseToast } from '@/apps/mail/utils'
import { useUndo } from '@/apps/mail/utils/composables'

/** Where a list is being cleared: an account's mailbox, or a folder across every account. */
export type ClearTarget = { account: string; mailbox: string } | { folder: string }

/**
 * What the list's menu clears: an Inbox tab, or a whole folder (no `category`: another folder, or an
 * Inbox not split into tabs), as far as the list's filter shows it; and its name, for the toasts.
 */
export type ClearScope = {
  category?: InboxCategory
  name: string
  /** The list's filter (`filter_by`): only what it shows is cleared. */
  filter?: string | null
}

/** A list's scope: its open Inbox tab, else the whole folder (`folder`, its name), with its filter. */
export const listScope = (
  tab: InboxCategory | undefined,
  folder: string,
  filter: string | null,
): ClearScope => (tab ? { category: tab, name: tabName(tab), filter } : { name: folder, filter })

type ClearAction = 'read' | 'archive' | 'trash'

/** What a clearing takes, as its toasts name it: the scope's mail, as far as the list's filter shows.
 *  Filters combine (comma-joined); more than one is just "Filtered mail", not spelled out. */
const mailOf = ({ name, filter }: ClearScope) => {
  if (filter?.includes(',')) return __('Filtered mail')
  switch (filter) {
    case 'unread':
      return __('Unread {0} mail', [name])
    case 'starred':
      return __('Starred {0} mail', [name])
    case 'has_attachments':
      return __('{0} mail with attachments', [name])
    case 'unscreened':
      return __('{0} mail from unknown senders', [name])
    default:
      return __('{0} mail', [name])
  }
}

const said = (action: ClearAction, mail: string) =>
  action === 'read'
    ? [__('{0} marked as read.', [mail]), __('{0} marked as unread.', [mail])]
    : [
        action === 'archive' ? __('{0} archived.', [mail]) : __('{0} moved to Trash.', [mail]),
        __('{0} moved back.', [mail]),
      ]

/**
 * Clearing a list in one go, on the server, and the list's menu for it. Mark all as read anywhere;
 * Archive all and Move all to Trash only on an Inbox tab of bulk mail, never Primary or a whole
 * folder. Each says so with Undo (its toast's button or Cmd/Ctrl+Z), which puts back exactly what it
 * changed: marked unread again, or each message back in every folder it was in, as undoing any move
 * does. An account can fail part way: what it cleared first is still undone, and the clearing says
 * it didn't finish.
 */
export const useClearList = (target: () => ClearTarget) => {
  const { setUndoAction, undo } = useUndo()

  const clear = async (action: ClearAction, scope: ClearScope) => {
    const { category, name, filter: filter_by } = scope
    const mail = mailOf(scope)
    const { cleared, failed } = await client.mutation(api.mail.messages.clearList, {
      action,
      ...target(),
      category,
      filter_by,
    })
    if (cleared.length) {
      const [done, undone] = said(action, mail)
      setUndoAction(() =>
        raiseOptimisticToast(
          Promise.all(
            cleared.map(({ account, ids, mails }) =>
              action === 'read'
                ? client.mutation(api.mail.messages.seen, { account, ids, seen: false })
                : client.mutation(api.mail.messages.setFolders, { account, mails: mails ?? [] }),
            ),
          ),
          undone,
        ),
      )
      raiseToast(done, 'success', { label: __('Undo'), onClick: undo })
    } else if (!failed.length)
      raiseToast(
        filter_by
          ? __('Nothing to clear.')
          : action === 'read'
            ? __('Nothing unread in {0}.', [name])
            : __('Nothing in {0}.', [name]),
      )
    if (failed.length) raiseToast(__('Not all {0} could be cleared.', [mail]), 'error')
  }

  const menuFor = (scope: ClearScope) => [
    {
      group: '',
      options: [
        {
          label: __('Mark all as read'),
          icon: 'lucide-mail-open',
          onClick: () => void clear('read', scope),
        },
        ...(scope.category && scope.category !== 'primary'
          ? [
              {
                label: __('Archive all'),
                icon: 'lucide-archive',
                onClick: () => void clear('archive', scope),
              },
              {
                label: __('Move all to Trash'),
                icon: 'lucide-trash-2',
                onClick: () => void clear('trash', scope),
              },
            ]
          : []),
      ],
    },
  ]

  return { clear, menuFor }
}
