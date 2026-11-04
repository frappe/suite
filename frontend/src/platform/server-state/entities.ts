/** Partitioned entities reconcile detail and list responses without persisting credentials. */
import { get, set } from 'idb-keyval'
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
const STORAGE_KEY = 'suite-api-entities-v2'

export class Entities {
  private readonly records = reactive(new Map<string, Entity>())
  private readonly confirmed = new Map<string, Entity>()
  private generation = 0
  private readonly hydration = new Map<string, Promise<void>>()

  constructor(private readonly persistence = true) {}

  hydrate(partition: string): Promise<void> {
    if (!this.persistence || typeof indexedDB === 'undefined') return Promise.resolve()
    let loading = this.hydration.get(partition)
    if (!loading) {
      const generation = this.generation
      loading = get<Entity[]>(STORAGE_KEY)
        .then((saved) => {
          if (generation !== this.generation) return
          for (const entity of saved ?? []) {
            if (entity.partition !== partition) continue
            const key = this.key(partition, entity.tag, entity.id)
            if (!this.records.has(key)) this.records.set(key, { ...entity, revision: 0 })
            if (!this.confirmed.has(key)) this.confirmed.set(key, { ...entity, revision: 0 })
          }
        })
        .catch(() => {})
      this.hydration.set(partition, loading)
    }
    return loading
  }

  normalize(
    value: unknown,
    declaration: EntityDeclaration | null | undefined,
    partition: string,
    revision: number,
  ): unknown {
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
        this.confirmed.set(key, entity)
        this.persist()
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
  ): () => void {
    const snapshots: Array<{ key: string; before: Entity; attempt: Entity }> = []
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
        if (stored) snapshots.push({ key, before, attempt: stored })
      }
    }
    return () => {
      for (const { key, before, attempt } of snapshots) {
        if (this.records.get(key) === attempt) this.records.set(key, before)
      }
    }
  }

  clear(): void {
    this.generation += 1
    this.records.clear()
    this.confirmed.clear()
    this.hydration.clear()
    this.persist()
  }

  private key(partition: string, tag: string, id: string): string {
    return JSON.stringify([partition, tag.replaceAll(' ', '').toLowerCase(), id])
  }

  private persist(): void {
    if (!this.persistence || typeof indexedDB === 'undefined') return
    // Save committed values, never reactive optimistic overlays or access credentials.
    const saved = [...this.confirmed.values()].map((entity) => ({
      ...entity,
      data: safeData(entity.data),
    }))
    void set(STORAGE_KEY, saved).catch(() => {})
  }
}

function compare(left: string | number | null, right: string | number | null): number {
  if (left === null || right === null) return 0
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeData(data: Record<string, unknown>): Record<string, unknown> {
  const { access: _access, ...publicData } = data
  return JSON.parse(JSON.stringify(publicData)) as Record<string, unknown>
}
