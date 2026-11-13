/** One answer from an app's server converter for an old version, as each app's endpoint sends it. */
interface VersionConversion {
  state?: string
  reason?: string
  pending?: boolean
}

/** An old version as the server converts it: its Yjs state, a refusal with its reason, or not done in time. */
export type ConvertedState =
  { state: Uint8Array } | { refused: string | null } | { isPending: true }

const ASK_EVERY_MS = 2000
const WAIT_MS = 150_000

/** Asks the server to convert an old version, again while it is busy, until it answers or the wait runs out. */
export async function askUntilConverted(
  ask: () => Promise<VersionConversion>,
): Promise<ConvertedState> {
  const giveUpAt = Date.now() + WAIT_MS
  let converted = await ask()
  while (converted.pending) {
    if (Date.now() >= giveUpAt) {
      return { isPending: true }
    }

    await new Promise((resolve) => setTimeout(resolve, ASK_EVERY_MS))
    converted = await ask()
  }

  if (!converted.state) {
    return { refused: converted.reason ?? null }
  }

  return { state: Uint8Array.from(atob(converted.state), (char) => char.charCodeAt(0)) }
}
