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
}

export function bannerFor({ blocked, onDevice, kept }: Standing): Banner {
  const copy = kept ? " Your unsent changes were kept as a recovery copy." : ""
  const note = onDevice
    ? " If you close this tab, they stay on this device until you can save again."
    : " Keep this tab open until then."
  switch (blocked) {
    case "signed_out":
      return {
        text: "You've been signed out, so your recent changes aren't saved yet.",
        signInUrl: `/login?redirect-to=${encodeURIComponent(location.pathname)}`,
        note,
      }
    case "locked":
      return { text: "This document was locked again, so your recent changes aren't saved yet. Unlock it to save them.", note }
    case "offline":
      return {
        text: "You're offline, and this browser isn't keeping changes for this site, so editing is paused until the connection is back.",
      }
    case "stale_session":
      return {
        text: onDevice
          ? "You signed in again in another tab. Reload to keep saving. Your unsent changes come back after the reload."
          : `You signed in again in another tab.${copy} Reload to keep saving.`,
      }
    case "other_user":
      return {
        text: onDevice
          ? "This browser is now signed in as someone else. Your unsent changes stay on this device until you sign back in. Reload to continue as them."
          : `This browser is now signed in as someone else.${copy} Reload to continue as them.`,
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
  signed_out: "You're signed out. Sign in again to open this document.",
  locked: "This document is locked. Unlock it to open it.",
  stale_session: "You signed in again in another tab. Reload to open this document.",
  principal_changed: "This browser is now signed in as someone else. Reload to open this document as them.",
}

export const openFailureFor = (reason: string | null) => OPEN_FAILURES[reason ?? ""] ?? "This document couldn't be opened."
