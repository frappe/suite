import { withBlankLines } from './text-editor'

/**
 * The mail body as the composer's editor receives it, and the inverse on the way back out. A blank
 * line leaves as one every mail client draws (see withBlankLines).
 *
 * What the editor last said goes back to it as it said it. The editor resets itself to any content
 * that differs from its own, and a reset throws the caret to the end of the body. Turning its blank
 * lines into `<div><br></div>` and back again on the way in was such a difference: the first
 * keystroke after "···" unfolded a quote reset the editor, and the rest of the reply was typed
 * below the quote.
 */
export const createEditorBody = () => {
  let last = { value: '', body: '' }
  return {
    toEditor: (body: string) => (body === last.body ? last.value : body),
    fromEditor: (value: string) => {
      last = { value, body: withBlankLines(value) }
      return last.body
    },
  }
}
