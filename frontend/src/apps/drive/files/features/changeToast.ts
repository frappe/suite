/**
 * Toasts that report a finished Drive change: a move, a move to Trash and a
 * restore, each with Undo, and a copy, without it.
 */
import { batchNodes, moveNode } from '@/apps/drive/client/nodes'
import type { DriveFailure } from '@/apps/drive/client/types'
import { toast } from '@/platform/feedback'
import { useMutation } from '@/platform/server-state'
import type { PlatformError } from '@/platform/transport'

/** An item a change touched, with the title its toast names. */
export interface ChangedItem {
  readonly node: string
  readonly title: string
}

/** An item a move placed: the folder it was in before the move, and the one it is in now. */
export interface MovedItem extends ChangedItem {
  /** Undo puts the item back in this folder. */
  readonly from: string
  /**
   * Where the move put it. Undo names this folder as the one it expects the
   * item in, so a move made elsewhere since, in another tab or by someone
   * else, makes the server refuse the Undo instead of pulling the item out of
   * its new folder.
   */
  readonly to: string
}

/** A toast with Undo stays long enough for the user to reach it. */
const UNDO_DURATION = 10_000

/**
 * The changes announced on each node, latest last. Undo takes a change back
 * only on the nodes where it is still the latest, so the Undo of an earlier
 * move cannot pull an item out of the folder a later move put it in. A change
 * that was taken back leaves the list, and the change before it is the latest
 * again. Changes made in another tab or by another user are not seen here.
 */
const changes = new Map<string, symbol[]>()

/** A change the user can take back from its toast. Messages are limited HTML. */
interface Undoable<Item extends ChangedItem> {
  /** What the toast says the change did. */
  done: string
  /** What the toast says once Undo took the change back. */
  undone: string
  /** What the toast says when Undo could not take back these items, named by `subject`. */
  stuck: (subject: string) => string
  /** Takes the change back. Answers the items that could not go back, with the server's reasons. */
  undo: (items: readonly Item[]) => Promise<DriveFailure[]>
}

/**
 * Reports a finished change in a toast with Undo. Undo runs at most once. When
 * it fails for some items, or a later change has moved them on, an error toast
 * names them with the reason.
 */
function announce<Item extends ChangedItem>(items: readonly Item[], change: Undoable<Item>): void {
  if (!items.length) return
  const id = Symbol('change')
  for (const item of items) changes.set(item.node, [...(changes.get(item.node) ?? []), id])
  let undone = false
  toast.success(change.done, {
    duration: UNDO_DURATION,
    action: {
      label: 'Undo',
      onClick: () => {
        if (undone) return
        undone = true
        void takeBack(id, items, change)
      },
    },
  })
}

async function takeBack<Item extends ChangedItem>(id: symbol, items: readonly Item[], change: Undoable<Item>) {
  const latest = items.filter((item) => changes.get(item.node)?.at(-1) === id)
  const later = items.filter((item) => !latest.includes(item))
  const refused = latest.length ? await change.undo(latest) : []
  for (const item of latest) {
    if (refused.some((failure) => failure.node === item.node)) continue
    const left = (changes.get(item.node) ?? []).filter((each) => each !== id)
    if (left.length) changes.set(item.node, left)
    else changes.delete(item.node)
  }
  const failed = [
    ...later.map((item) => ({ node: item.node, type: 'Changed', message: later.length === 1 ? 'It changed again after that.' : 'They changed again after that.' })),
    ...refused,
  ]
  if (!failed.length) {
    toast.success(change.undone)
    return
  }
  const stuck = items.filter((item) => failed.some((failure) => failure.node === item.node))
  const reason = failed.find((failure) => failure.message)?.message
  toast.error(change.stuck(subject(stuck)), reason ? { description: reason } : undefined)
}

/**
 * Reports a move. `destination` is the title of the folder the items went to.
 * Undo moves each item back to the folder it came from.
 */
export function announceMove(items: readonly MovedItem[], destination: string): void {
  announce(items, {
    done: `Moved ${subject(items)} to ${escapeHtml(destination)}`,
    undone: `Moved ${subject(items)} back`,
    stuck: (what) => `Could not move ${what} back`,
    undo: (moved) => moved.length === 1 ? moveBack(moved[0]!) : moveAllBack(moved),
  })
}

/** Reports items moved to Trash. Undo restores them. */
export function announceTrash(items: readonly ChangedItem[]): void {
  announce(items, {
    done: `Moved ${subject(items)} to Trash`,
    undone: `Restored ${subject(items)}`,
    stuck: (what) => `Could not restore ${what}`,
    undo: (trashed) => setState(trashed, 'Active'),
  })
}

/** Reports a copy. A copy is a new item the user can delete, so its toast offers no Undo. */
export function announceCopy(item: ChangedItem, destination: string): void {
  toast.success(`Copied ${subject([item])} to ${escapeHtml(destination)}`)
}

/** Reports items restored from Trash, to where they were or to a folder the user chose. Undo moves them back to Trash. */
export function announceRestore(items: readonly ChangedItem[]): void {
  announce(items, {
    done: `Restored ${subject(items)}`,
    undone: `Moved ${subject(items)} back to Trash`,
    stuck: (what) => `Could not move ${what} back to Trash`,
    undo: (restored) => setState(restored, 'Trashed'),
  })
}

/** One item goes back through the single move route. Answers what failed. */
async function moveBack(item: MovedItem): Promise<DriveFailure[]> {
  const move = useMutation(moveNode(), { silent: true })
  if (await move.run({ node: item.node, parent_node: item.from, expect_parent_node: item.to })) return []
  return [refusal(item.node, move.error)]
}

/** Several items go back through the batch route, one request for each pair of folders they went between. */
async function moveAllBack(items: readonly MovedItem[]): Promise<DriveFailure[]> {
  const batch = useMutation(batchNodes(), { silent: true })
  const byMove = new Map<string, MovedItem[]>()
  for (const item of items) {
    const key = `${item.from}\u0000${item.to}`
    byMove.set(key, [...(byMove.get(key) ?? []), item])
  }
  const failed: DriveFailure[] = []
  for (const group of byMove.values()) {
    const nodes = group.map((item) => item.node)
    const { from, to } = group[0]!
    const result = await batch.run({ nodes, patch: { parent_node: from, expect_parent_node: to } })
    failed.push(...(result ? result.failed : nodes.map((node) => refusal(node, batch.error))))
  }
  return failed
}

/** Trashes or restores the items in one batch request. Answers what failed. */
async function setState(items: readonly ChangedItem[], state: 'Active' | 'Trashed'): Promise<DriveFailure[]> {
  const batch = useMutation(batchNodes(), { silent: true })
  const nodes = items.map((item) => item.node)
  const result = await batch.run({ nodes, patch: { state } })
  return result ? result.failed : nodes.map((node) => refusal(node, batch.error))
}

function refusal(node: string, error: PlatformError | null): DriveFailure {
  return { node, type: error?.type ?? 'Error', message: error?.message ?? '' }
}

/** “Report.pdf” for one item, “3 items” for several. */
export function subject(items: readonly ChangedItem[]): string {
  return items.length === 1 ? `“${escapeHtml(items[0]!.title)}”` : `${items.length} items`
}

/** The toast renders its message as limited HTML, so a title shows as typed. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
