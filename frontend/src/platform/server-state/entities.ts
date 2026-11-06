/** Partitioned entities reconcile detail and list responses. They live only in memory. */
import { del } from 'idb-keyval'
import { reactive } from 'vue'

import type { EntityDeclaration } from '@/platform/transport'

interface Entity {
  partition: string
  tag: string
  id: string
  version: string | number | null
  data: Record<string, unknown>
  revision: number
}
interface EntityReference {
  __suiteEntity: string
}
/**
 * Earlier builds saved entities, file titles included, under this IndexedDB key and
 * never showed them. Delete the leftover copy. Remove this after a few releases.
 */
const RETIRED_STORAGE_KEY = 'suite-api-entities-v2'
export function deleteRetiredEntityStore(): void {
  if (typeof indexedDB !== 'undefined') void del(RETIRED_STORAGE_KEY).catch(() => {})
}

export class Entities {
  private readonly records = reactive(new Map<string, Entity>())

  normalize<Value>(
    value: Value,
    declaration: EntityDeclaration | null | undefined,
    partition: string,
    revision: number,
  ): Value | EntityReference | unknown[] | Record<string, unknown> {
    if (Array.isArray(value))
      return value.map((item) => this.normalize(item, declaration, partition, revision))
    if (!isRecord(value) || value instanceof Blob) return value
    if (declaration && value[declaration.id] !== undefined && value[declaration.id] !== null) {
      const id = String(value[declaration.id])
      const key = this.key(partition, declaration.tag, id)
      const previous = this.records.get(key)
      const rawVersion = declaration.version ? value[declaration.version] : null
      const version =
        typeof rawVersion === 'string' || typeof rawVersion === 'number' ? rawVersion : null
      if (!previous || (previous.revision <= revision && compare(version, previous.version) >= 0)) {
        const data =
          previous && version !== null && version === previous.version
            ? { ...previous.data, ...value }
            : { ...value }
        const entity = { partition, tag: declaration.tag, id, version, data, revision }
        this.records.set(key, entity)
      }
      return { __suiteEntity: key } satisfies EntityReference
    }
    return Object.fromEntries(
      Object.entries(value).map(([field, child]) => [
        field,
        this.normalize(child, field === 'rows' ? declaration : undefined, partition, revision),
      ]),
    )
  }

  materialize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.materialize(item))
    if (!isRecord(value) || value instanceof Blob) return value
    if (typeof value.__suiteEntity === 'string') return this.records.get(value.__suiteEntity)?.data
    return Object.fromEntries(
      Object.entries(value).map(([field, child]) => [field, this.materialize(child)]),
    )
  }

  optimistic<I>(
    partition: string,
    tag: string | undefined,
    input: I,
    ids: readonly string[],
    update?: (input: I, entity: Record<string, unknown>) => Record<string, unknown> | void,
  ): (only?: readonly string[]) => void {
    const snapshots: Array<{ id: string; key: string; before: Entity; attempt: Entity }> = []
    if (tag && update) {
      for (const id of ids) {
        const key = this.key(partition, tag, id)
        const before = this.records.get(key)
        if (!before) continue
        const patch = update(input, { ...before.data })
        if (!patch) continue
        const attempt = { ...before, data: { ...before.data, ...patch } }
        this.records.set(key, attempt)
        const stored = this.records.get(key)
        if (stored) snapshots.push({ id, key, before, attempt: stored })
      }
    }
    // Undoes every patch, or only those of the ids in `only`.
    return (only) => {
      for (const { id, key, before, attempt } of snapshots) {
        if (only && !only.includes(id)) continue
        if (this.records.get(key) === attempt) this.records.set(key, before)
      }
    }
  }

  clear(): void {
    this.records.clear()
  }

  private key(partition: string, tag: string, id: string): string {
    return JSON.stringify([partition, tag.replaceAll(' ', '').toLowerCase(), id])
  }
}

function compare(left: string | number | null, right: string | number | null): number {
  if (left === null || right === null) return 0
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

export function isRecord<Value>(value: Value): value is Value & Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
