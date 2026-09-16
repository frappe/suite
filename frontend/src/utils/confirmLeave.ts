import { dialog } from 'frappe-ui'

export function confirmLeave({
  title = 'Leave this page?',
  message = 'Your unsaved changes may be lost.',
  confirmLabel = 'Leave',
  focusConfirm = false,
} = {}) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const actions = focusConfirm
      ? [
          {
            label: 'Stay',
            variant: 'outline' as const,
            onClick: () => finish(false),
          },
          {
            label: confirmLabel,
            variant: 'solid' as const,
            theme: 'red' as const,
            autofocus: true,
            onClick: () => finish(true),
          },
        ]
      : undefined

    dialog.confirm({
      title,
      message,
      confirmLabel,
      cancelLabel: 'Stay',
      theme: 'red',
      onConfirm: () => finish(true),
      onCancel: () => finish(false),
      actions,
    })
  })
}
