import type { Blocked } from '@suite/collab-client'

// What the page tells the person when the room stops saving, or never opens
export interface Banner {
  text: string
  // Said after the text, and after the sign-in link when there is one
  note?: string
  signInUrl?: string
}

interface Standing {
  blocked: Blocked | null
  onDevice: boolean
  // The editor's HTML was kept in this browser as a recovery copy
  kept: boolean
  unsent: number
}

export function bannerFor({ blocked, onDevice, kept, unsent }: Standing): Banner {
  const copy = kept ? " Unsent changes were kept as a recovery copy." : ""
  const note = onDevice ? "" : " Keep this tab open."
  switch (blocked) {
    case "signed_out":
      return {
        text: unsent ? "You're signed out, so changes aren't saved." : "You're signed out.",
        signInUrl: `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
        note: unsent ? ` to save them.${note}` : " to keep editing.",
      }
    case "locked":
      return { text: "This document was locked, so changes aren't saved. Unlock it to save them.", note }
    case "offline":
      return { text: "You're offline and this browser can't keep changes, so editing is paused." }
    case "stale_session":
      return { text: `You signed in again in another tab.${onDevice ? "" : copy} Reload to keep saving.` }
    case "other_user":
      return {
        text: onDevice
          ? "Someone else is now signed in here. Your unsent changes are kept on this device."
          : `Someone else is now signed in here.${copy} Reload to continue.`,
      }
    case "lost_edit":
      return { text: `You can no longer edit this document.${copy}` }
    case "lost_read":
      return { text: `You can no longer open this document.${copy}` }
    default:
      return { text: `Saving stopped in this tab.${copy} Reload to keep editing.` }
  }
}

const OPEN_FAILURES: Record<string, string> = {
  signed_out: "You're signed out. Sign in to open this document.",
  locked: "This document is locked. Unlock it to open it.",
  stale_session: "You signed in again in another tab. Reload to open this.",
  principal_changed: "Someone else is now signed in here. Reload to open this document.",
}

function failureForStatus(status: number | null) {
  if (status === 0) return "Couldn't reach the server. Check your connection and try again."
  if (status === 408 || status === 429) return "The server is busy. Try again in a moment."
  if (status !== null && status >= 500) return "The server had a problem opening this document. Try again in a moment."
  return "This document couldn't be opened."
}

export const openFailureFor = (reason: string | null, status: number | null = null) =>
  OPEN_FAILURES[reason ?? ""] ?? failureForStatus(status)
