import { toast } from '@/platform/feedback'
import { translate as __ } from '@/platform/translation'

/** Copies a settings value, such as a key or a URL, and says whether it worked. */
export async function copyValue(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(__('Copied'))
  } catch {
    toast.error(__('Could not copy. Select the text and copy it.'))
  }
}
