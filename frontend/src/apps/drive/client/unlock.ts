import { api } from './generated'
import { driveLinks, type LinkStore } from './links'
import { driveOperation } from './operation'
import { TransportError, transport as defaultTransport, type Transport } from '@/platform/transport'

/**
 * Opens a password link for one node (spec §10.2, Drive §6.3).
 *
 * The node answered `401 DriveLocked`, so this browser reached it through a
 * link it holds. The password buys an unlock ticket, and the link store sends
 * it with that link's code from then on (Drive §4.8).
 */

/** Drive §6.3 locks a link out for fifteen minutes. Used when a 429 names no wait. */
export const LOCKOUT_MS = 15 * 60_000

export type UnlockOutcome =
  | { status: 'unlocked' }
  | { status: 'wrong-password' }
  | { status: 'locked-out'; retryAfterMs: number }
  | { status: 'failed'; message: string }

interface UnlockDependencies {
  transport?: Transport
  links?: Pick<LinkStore, 'codeFor' | 'unlock'>
}

type UnlockInput = { token: string; password: string }
type UnlockOutput = { ticket: string; expires: number }

// The generated schema has no `password`: the route reads it as an untyped argument.
const unlockOperation = driveOperation<UnlockInput, UnlockOutput>(api.link_unlock, { looseInput: true })

export async function unlockNode(
  node: string,
  password: string,
  dependencies: UnlockDependencies = {},
): Promise<UnlockOutcome> {
  const links = dependencies.links ?? driveLinks
  const token = links.codeFor(node)
  // Only a link this browser holds can lock a node, so a missing code means it was forgotten.
  if (!token) return { status: 'failed', message: 'Open the share link again.' }
  try {
    const { ticket } = await (dependencies.transport ?? defaultTransport).request(unlockOperation, { token, password })
    links.unlock(token, ticket)
    return { status: 'unlocked' }
  } catch (error) {
    if (!(error instanceof TransportError)) throw error
    if (error.status === 401 && error.type === 'DriveLocked') return { status: 'wrong-password' }
    if (error.status === 429) return { status: 'locked-out', retryAfterMs: error.retryAfterMs ?? LOCKOUT_MS }
    return { status: 'failed', message: error.message }
  }
}

const nodeGet = driveOperation<{ node: string }, unknown>(api.node_get, { entity: true })

/**
 * Asks the server once whether this node is refused for a link password, as
 * when an unlock ticket expires while someone browses. Any other answer,
 * success included, is `false`.
 */
export async function isDriveNodeLocked(node: string, transport: Transport = defaultTransport): Promise<boolean> {
  try {
    await transport.request(nodeGet, { node })
    return false
  } catch (error) {
    return isDriveLocked(error)
  }
}

/** Whether a refusal asks for the link password: the node route shows the unlock screen in place. */
export function isDriveLocked(error: unknown): boolean {
  return error instanceof TransportError && error.status === 401 && error.type === 'DriveLocked'
}
