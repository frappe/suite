import { translate as __ } from '@/platform/translation'

/**
 * The native file picker, from a throwaway input. It resolves with the
 * chosen files, or none when the user cancels. A browser opens a picker
 * only inside a click; without one it opens nothing and fires no event, so
 * this rejects at once instead of waiting forever.
 */
export function pickFiles({ multiple = false } = {}): Promise<File[]> {
  return new Promise((resolve, reject) => {
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      reject(new Error(__('Choose the file again to resume.')))
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.hidden = true
    const settle = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => settle([...(input.files ?? [])]), { once: true })
    input.addEventListener('cancel', () => settle([]), { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
