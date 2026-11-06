import { computed, shallowRef, type ComputedRef } from 'vue'

/**
 * The tweak ids. Each product's tweak registry adds its own ids here through
 * declaration merging, so platform code can read a product's tweak without
 * importing the product, and a misspelt id is a type error everywhere.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled by declaration merging
export interface TweakIds {}

export type TweakId = keyof TweakIds & string

/**
 * Evaluation switches: each one turns one UI change on or off in this
 * browser, so old and new behaviour can be compared in the running app.
 * Every tweak starts on. The store keeps only the ids switched off; an id
 * that no registry declares has no effect.
 */
const KEY = 'suite.tweaks'

const off = shallowRef<ReadonlySet<string>>(read())

if (typeof window !== 'undefined') {
  // Another tab flipped a switch.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) off.value = parse(event.newValue)
  })
}

/** Whether the change behind `id` is on. Reactive inside a computed, a watcher or a render. */
export function isTweakOn(id: TweakId): boolean {
  return !off.value.has(id)
}

/** `isTweakOn` as a computed. Call it in a component's setup. */
export function useTweak(id: TweakId): ComputedRef<boolean> {
  return computed(() => isTweakOn(id))
}

/** Turns every tweak in `ids` on or off, and keeps the choice in this browser. */
export function setTweaks(ids: readonly TweakId[], on: boolean): void {
  const next = new Set(off.value)
  for (const id of ids) {
    if (on) next.delete(id)
    else next.add(id)
  }
  off.value = next
  try {
    localStorage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    // Browser storage is best-effort. The switch still applies to this page.
  }
}

function read(): ReadonlySet<string> {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    return new Set()
  }
}

function parse(raw: string | null): ReadonlySet<string> {
  let value: unknown
  try {
    value = JSON.parse(raw ?? '[]')
  } catch {
    return new Set()
  }
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((id): id is string => typeof id === 'string'))
}
