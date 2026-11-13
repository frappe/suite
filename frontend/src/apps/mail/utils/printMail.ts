/**
 * Printing a conversation, or one message of it, through the browser's print dialog — which is also
 * where a PDF is saved. The page is built here, apart from the app's own: just the mail, on white,
 * each message under who sent it, to whom and when, with the names of its attachments.
 */
import { containEmailHtml } from '@/apps/mail/utils/containEmailHtml'
import { inUserTimeZone } from '@/apps/mail/utils/datetime'
import { escapeHtml } from '@/apps/mail/utils/html'
import { sanitizeEmailHtml } from '@/apps/mail/utils/sanitizeEmail'

/**
 * One message as it is printed. `body` is the sender's HTML as it arrived; it is cleaned and
 * contained here, with remote content held back when `blockRemote` says the reader holds it back.
 * `receivedAt` is the UTC timestamp from the API.
 */
export interface PrintedMessage {
  from: string
  to: string
  cc: string
  receivedAt: string
  body: string
  blockRemote: boolean
  attachments: readonly string[]
}

const PAGE_STYLE = `
  body { font: 13px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #171717; margin: 0; }
  h1 { font-size: 20px; font-weight: 600; margin: 0 0 16px; }
  .message { padding: 16px 0; border-top: 1px solid #e2e2e2; }
  .header { margin-bottom: 12px; break-inside: avoid; break-after: avoid; }
  .header div { color: #525252; }
  .header .from { color: #171717; font-weight: 600; }
  .header span { color: #7c7c7c; }
  .attachments { margin-top: 12px; color: #525252; }
  img { max-width: 100%; height: auto; }
  img[data-blocked-image] { display: none; }
  table { max-width: 100%; }
  pre, code { white-space: pre-wrap; }
  @page { margin: 16mm; }
`

const line = (label: string, value: string) =>
  value ? `<div><span>${escapeHtml(label)}:</span> ${escapeHtml(value)}</div>` : ''

/** The page that prints `messages` under `subject`. */
export const printPage = (subject: string, messages: readonly PrintedMessage[]): string => {
  const title = escapeHtml(subject || __('[No Subject]'))
  const sections = messages
    .map((message) => {
      // Cleaned as the reader cleans it; the sender's style rules kept, but kept to their own body.
      const body = containEmailHtml(sanitizeEmailHtml(message.body, message.blockRemote))
      const attachments = message.attachments.length
        ? `<div class="attachments">${escapeHtml(
            __('{0} attachments: {1}', [
              String(message.attachments.length),
              message.attachments.join(', '),
            ]),
          )}</div>`
        : ''
      return `<section class="message">
        <div class="header">
          <div class="from">${escapeHtml(message.from)}</div>
          ${line(__('To'), message.to)}
          ${line(__('Cc'), message.cc)}
          ${line(__('Date'), inUserTimeZone(message.receivedAt).format('ddd, D MMM YYYY [at] h:mm A'))}
        </div>
        ${body}
        ${attachments}
      </section>`
    })
    .join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>${PAGE_STYLE}</style></head><body><h1>${title}</h1>${sections}</body></html>`
}

// A browser may not tell this window when a scriptless frame's dialog has closed, so a frame
// still standing from the last print goes when the next one starts.
let lastFrame: HTMLIFrameElement | undefined

/**
 * Prints the page from a frame of its own, out of sight, so the app around it isn't printed: the
 * dialog that opens offers the printers, and Save as PDF. The frame goes once the dialog has closed.
 */
export const printMessages = (subject: string, messages: readonly PrintedMessage[]) => {
  lastFrame?.remove()
  const frame = document.createElement('iframe')
  lastFrame = frame
  frame.setAttribute('aria-hidden', 'true')
  // No scripts run in the page, and nothing in it can navigate or open a window. print() needs
  // allow-modals, or a sandboxed frame ignores it; allow-same-origin lets this window call it and
  // hear afterprint — without allow-scripts the page itself still can't reach back.
  frame.setAttribute('sandbox', 'allow-modals allow-same-origin')
  frame.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 0; height: 0; border: 0;'
  frame.srcdoc = printPage(subject, messages)
  frame.addEventListener('load', () => {
    const view = frame.contentWindow
    if (!view) return frame.remove()
    view.addEventListener('afterprint', () => frame.remove())
    view.focus()
    view.print()
  })
  document.body.append(frame)
}
