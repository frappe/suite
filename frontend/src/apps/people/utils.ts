import { toast } from 'frappe-ui'

import { translate as __ } from '@/platform/translation'

export const raiseToast = (message: string, type = 'success') => {
  if (type === 'success') return toast.success(message)

  const div = document.createElement('div')
  div.innerHTML = message
  // strip html tags
  const text =
    div.textContent || div.innerText || __('Could not perform the action. Try again later.')
  toast.error(text)
}

/** A readable name from an address's local part: `jane.doe@…` reads "Jane Doe". */
export const extractNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .replace(/[._-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
