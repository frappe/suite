import type { Transaction } from '@tiptap/pm/state'
import type { Mappable } from '@tiptap/pm/transform'

export type Range = [number, number]

export function rangesChangedBy(tr: Transaction) {
  const ranges: Range[] = []
  for (const [i, step] of tr.steps.entries()) {
    const laterMapping = tr.mapping.slice(i + 1)
    function addRange(_from: number, _to: number, from: number, to: number) {
      ranges.push([laterMapping.map(from, -1), laterMapping.map(to, 1)])
    }

    step.getMap().forEach(addRange)
  }

  return ranges
}

export function mapRanges(ranges: Range[], mapping: Mappable) {
  return ranges.map(([from, to]): Range => [mapping.map(from, -1), mapping.map(to, 1)])
}

// Where `transactions` changed the document, in the last one's positions;
// normalizers fix only there, or the guard refuses their whole transaction
export function changedRanges(transactions: readonly Transaction[], ranges: Range[] = []) {
  let changed = ranges
  for (const tr of transactions) {
    changed = [...mapRanges(changed, tr.mapping), ...rangesChangedBy(tr)]
  }

  return changed
}

export function touches(ranges: Range[], from: number, to = from) {
  return ranges.some(([start, end]) => from <= end && start <= to)
}
