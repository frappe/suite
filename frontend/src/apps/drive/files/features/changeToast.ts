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

/** An item a move placed, and the folder it was in before the move. */
export interface MovedItem extends ChangedItem {
  /** Undo puts the item back in this folder. */
  readonly from: string
}

/** A toast with Undo stays long enough for the user to reach it. */
const UNDO_DURATION = 10_000

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
 * it fails for some items, an error toast names them with the server's reason.
 */
function announce<Item extends ChangedItem>(items: readonly Item[], change: Undoable<Item>): void {
  if (!items.length) return
  let undone = false
  toast.success(change.done, {
    duration: UNDO_DURATION,
    action: {
      label: 'Undo',
      onClick: () => {
        if (undone) return
        undone = true
        void takeBack(items, change)
      },
    },
  })
}

async function takeBack<Item extends ChangedItem>(items: readonly Item[], change: Undoable<Item>) {
  const failed = await change.undo(items)
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
  if (await move.run({ node: item.node, parent: item.from })) return []
  return [refusal(item.node, move.error)]
}

/** Several items go back through the batch route, one request for each folder they came from. */
async function moveAllBack(items: readonly MovedItem[]): Promise<DriveFailure[]> {
  const batch = useMutation(batchNodes(), { silent: true })
  const byFolder = new Map<string, string[]>()
  for (const item of items) byFolder.set(item.from, [...(byFolder.get(item.from) ?? []), item.node])
  const failed: DriveFailure[] = []
  for (const [parent, nodes] of byFolder) {
    const result = await batch.run({ nodes, patch: { parent } })
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
