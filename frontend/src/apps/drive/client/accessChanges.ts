/**
 * Tells open sessions that a node's grants changed, so they read their own
 * access again at once (unified spec §7.9, §8.6). The share dialog announces
 * after every write. A document session listens for its own node.
 */

type Listener = () => void

const listeners = new Map<string, Set<Listener>>()

/** Calls `listener` after each announced change to `node`. Returns the stop function. */
export function onAccessChange(node: string, listener: Listener): () => void {
  const set = listeners.get(node) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(node, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(node)
  }
}

export function announceAccessChange(node: string): void {
  for (const listener of [...(listeners.get(node) ?? [])]) listener()
}
