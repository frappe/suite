import type { DriveBatchResult } from '@/apps/drive/client/types'

export function batchResultText(result: DriveBatchResult, verb: string): string {
  return `${result.ok.length} ${verb} · ${result.failed.length} failed`
}
