// Undo on a converted presentation: one stack over its slides, elements and text,
// holding only what this tab wrote (Q32, Q33). Yjs does the undoing. This adds what
// it doesn't: one step per press, a limit, and which items each step changed

import * as Y from 'yjs'

import { ROOT } from './deck'

const MOST_STEPS = 200
const STEP_PAUSE_MS = 500
const ITEMS = 'items'

type Kind = keyof typeof ROOT
type Fields = Record<string, unknown>
type DeepEvent = Y.YEvent<Y.AbstractType<unknown>>
/** The ids a step changed, with what this tab last saw of those it could see. */
type StepItems = Record<Kind, Map<string, Fields | null>>

export type StepDirection = 'undo' | 'redo'

function noItems(): StepItems {
  return { slides: new Map(), elements: new Map() }
}

// A nested type, the text, is restored by Yjs along with its item
function plainFields(item: Y.Map<unknown>) {
  return Object.fromEntries([...item.entries()].filter(([, v]) => !(v instanceof Y.AbstractType)))
}

export function openLiveUndo(doc: Y.Doc, trackedOrigins: unknown[]) {
  const roots: Record<Kind, Y.Map<Y.Map<unknown>>> = {
    slides: doc.getMap(ROOT.slides),
    elements: doc.getMap(ROOT.elements),
  }
  const manager = new Y.UndoManager(Object.values(roots), {
    trackedOrigins: new Set(trackedOrigins),
    captureTimeout: STEP_PAUSE_MS,
  })
  let pending = noItems()
  let isTaking = false
  let shouldEndStep = false

  /** Remembers these items as they are now, for the step the next write makes. */
  function keep(kind: Kind, ids: Iterable<string>) {
    for (const id of ids) {
      const item = roots[kind].get(id)
      if (item) {
        pending[kind].set(id, plainFields(item))
      }
    }
  }

  function noteChanged(kind: Kind, events: DeepEvent[], transaction: Y.Transaction) {
    if (!manager.trackedOrigins.has(transaction.origin)) {
      return
    }

    for (const event of events) {
      const [changedId] = event.path
      const ids = typeof changedId === 'string' ? [changedId] : [...event.changes.keys.keys()]
      for (const id of ids) {
        if (!pending[kind].has(id)) {
          pending[kind].set(id, null)
        }
      }
    }
  }

  const observers = {
    slides: (events: DeepEvent[], tr: Y.Transaction) => noteChanged('slides', events, tr),
    elements: (events: DeepEvent[], tr: Y.Transaction) => noteChanged('elements', events, tr),
  }

  function fileItems({ stackItem }: { stackItem: { meta: Map<unknown, unknown> } }) {
    // SAFETY: only this function writes this key, and always a `StepItems`
    const items = (stackItem.meta.get(ITEMS) as StepItems | undefined) ?? noItems()
    for (const kind of ['slides', 'elements'] as const) {
      pending[kind].forEach((fields, id) => {
        if (fields || !items[kind].has(id)) {
          items[kind].set(id, fields)
        }
      })
    }

    stackItem.meta.set(ITEMS, items)
    pending = noItems()
    if (!isTaking && manager.undoStack.length > MOST_STEPS) {
      manager.undoStack.shift()
    }
  }

  function writeBackMissing(items: StepItems, wasGone: Set<string>) {
    // no origin: this is no step of its own, and must leave the redo in place (Q38)
    doc.transact(() => {
      for (const kind of ['slides', 'elements'] as const) {
        items[kind].forEach((fields, id) => {
          const item = roots[kind].get(id)
          if (!item || !fields || !wasGone.has(id)) {
            return
          }

          for (const [key, value] of Object.entries(fields)) {
            if (!item.has(key)) {
              item.set(key, value)
            }
          }
        })
      }
    })
  }

  /** Takes one step off the stack. Null when there is none to take. */
  function take(direction: StepDirection) {
    const [from, to] =
      direction === 'undo'
        ? (['undoStack', 'redoStack'] as const)
        : (['redoStack', 'undoStack'] as const)
    const top = manager[from].at(-1)
    if (!top) {
      return null
    }

    // SAFETY: `fileItems` runs for every step that reaches either stack
    const items = top.meta.get(ITEMS) as StepItems
    const wasGone = new Set<string>()
    for (const kind of ['slides', 'elements'] as const) {
      keep(kind, items[kind].keys())
      for (const id of items[kind].keys()) {
        if (!roots[kind].has(id)) {
          wasGone.add(id)
        }
      }
    }

    // Yjs goes on past a step that did nothing and undoes the one before in the same
    // press (Q36), so this step is alone on its stack while it runs. The others wait
    // on the opposite stack, as Yjs reads both to tell this tab's changes from a co-editor's
    const waiting = manager[from].slice(0, -1)
    const opposite = manager[to]
    manager[from] = [top]
    manager[to] = [...opposite, ...waiting]
    isTaking = true
    let isBlocked = true
    try {
      isBlocked = (direction === 'undo' ? manager.undo() : manager.redo()) === null
    } finally {
      isTaking = false
      const madeNow = manager[to].slice(opposite.length + waiting.length)
      manager[from] = waiting
      manager[to] = [...opposite, ...madeNow]
      pending = noItems()
    }

    if (!isBlocked) {
      writeBackMissing(items, wasGone)
    }

    return {
      isBlocked,
      slideIds: [...items.slides.keys()],
      elementIds: [...items.elements.keys()],
    }
  }

  /** Makes the next write a step of its own, with nothing after it joining. */
  function endStep() {
    shouldEndStep = true
  }

  function write(change: () => void) {
    const isOwnStep = shouldEndStep
    shouldEndStep = false
    if (isOwnStep) {
      manager.stopCapturing()
    }

    change()
    if (isOwnStep) {
      manager.stopCapturing()
    }
  }

  roots.slides.observeDeep(observers.slides)
  roots.elements.observeDeep(observers.elements)
  manager.on('stack-item-added', fileItems)
  manager.on('stack-item-updated', fileItems)

  return {
    manager,
    keep,
    take,
    endStep,
    write,
    stop() {
      roots.slides.unobserveDeep(observers.slides)
      roots.elements.unobserveDeep(observers.elements)
      manager.destroy()
    },
  }
}
