import { dialog } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

export function confirmRemoveParticipant({
  name,
  canBan,
  remove,
}: {
  name: string
  canBan: boolean
  remove: (ban: boolean) => void
}) {
  const title = name ? __('Remove {0}?', [name]) : __('Remove this participant?')
  if (!canBan) {
    dialog.confirm({
      title,
      theme: 'red',
      confirmLabel: __('Remove'),
      onConfirm: () => remove(false),
    })
    return
  }
  dialog.prompt({
    title,
    theme: 'red',
    confirmLabel: __('Remove'),
    fields: [
      { name: 'ban', type: 'checkbox', label: __('Ban from this meeting'), defaultValue: false },
    ],
    onConfirm: ({ values }) => remove(values.ban === true),
  })
}
