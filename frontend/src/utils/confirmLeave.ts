import { dialog } from 'frappe-ui'

export function confirmLeave({
  title = 'Leave this page?',
  message = 'Your unsaved changes may be lost.',
  confirmLabel = 'Leave',
} = {}) {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    dialog.confirm({
      title,
      message,
      confirmLabel,
      cancelLabel: 'Stay',
      theme: 'red',
      onConfirm: () => finish(true),
      onCancel: () => finish(false),
    })
  })
}
