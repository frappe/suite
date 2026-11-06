import type { DriveBatchResult, DriveFailure, DriveNode } from '@/apps/drive/client/types'
import { translate as __ } from '@/platform/translation'

/** What a batch did, as the outcome words it. */
export type BatchVerb = 'moved' | 'moved to trash' | 'restored' | 'deleted forever'

/** An item a batch named, as the listing showed it. */
export type BatchItem = Pick<DriveNode, 'name' | 'title' | 'kind' | 'mime' | 'content_doctype'>

export function batchResultText(result: DriveBatchResult, verb: BatchVerb): string {
  return `${result.ok.length} ${verb} · ${result.failed.length} failed`
}

/**
 * The outcome's title while t32 is on: one failure names its item, more
 * than one counts them. One key per verb, because word order differs by
 * language.
 */
export function batchFailureTitle(
  result: DriveBatchResult,
  verb: BatchVerb,
  title: (node: string) => string,
): string {
  const [only] = result.failed
  if (result.failed.length === 1 && only) return ONE_FAILED[verb](title(only.node))
  return SOME_FAILED[verb](result.failed.length, result.ok.length + result.failed.length)
}

const ONE_FAILED: Record<BatchVerb, (title: string) => string> = {
  moved: (title) => __('“{0}” could not be moved', [title]),
  'moved to trash': (title) => __('“{0}” could not be moved to Trash', [title]),
  restored: (title) => __('“{0}” could not be restored', [title]),
  'deleted forever': (title) => __('“{0}” could not be deleted forever', [title]),
}

const SOME_FAILED: Record<BatchVerb, (failed: number, total: number) => string> = {
  moved: (failed, total) => __('{0} of {1} items could not be moved', [failed, total]),
  'moved to trash': (failed, total) =>
    __('{0} of {1} items could not be moved to Trash', [failed, total]),
  restored: (failed, total) => __('{0} of {1} items could not be restored', [failed, total]),
  'deleted forever': (failed, total) =>
    __('{0} of {1} items could not be deleted forever', [failed, total]),
}

/**
 * Why one item failed, chosen by the error type: the server's messages name
 * the node by its id. A type without a sentence here keeps the server's text.
 */
export function failureReason(failure: DriveFailure): string {
  switch (failure.type) {
    case 'DriveForbidden':
      return __("You don't have permission.")
    case 'DriveNotFound':
      return __('It was moved or deleted by someone else.')
    case 'DriveConflict':
      return __('An item with this name is already there.')
    default:
      return failure.message
  }
}
