import { Fragment, defineComponent, h, render, shallowRef, type AppContext, type Component } from 'vue'

/**
 * Opens Drive dialogs by function call, so other products never render a Drive
 * dialog component or bind its props and events (spec §5.15).
 *
 * One host renders every open dialog inside the caller's app context, so the
 * router, frappe-ui's providers and the server-state cache all apply.
 */

type DialogModule = { default: Component }

interface Entry {
  id: number
  component: Component
  props: Record<string, unknown>
  open: boolean
  settle: () => void
}

const entries = shallowRef<Entry[]>([])
let nextId = 0
let hostContext: AppContext | null = null

function close(id: number) {
  const entry = entries.value.find((candidate) => candidate.id === id)
  if (!entry?.open) return
  entries.value = entries.value.map((candidate) => (candidate.id === id ? { ...candidate, open: false } : candidate))
  entry.settle()
}

// A closed dialog stays rendered until its leave transition ends.
function prune(id: number) {
  entries.value = entries.value.filter((candidate) => candidate.id !== id || candidate.open)
}

const DriveDialogHost = defineComponent({
  name: 'DriveDialogHost',
  setup: () => () =>
    h(
      Fragment,
      entries.value.map((entry) =>
        h(entry.component, {
          key: entry.id,
          ...entry.props,
          open: entry.open,
          'onUpdate:open': (open: boolean) => {
            if (!open) close(entry.id)
          },
          onAfterLeave: () => prune(entry.id),
        }),
      ),
    ),
})

function mountHost(context: AppContext) {
  if (hostContext === context) return
  hostContext = context
  const vnode = h(DriveDialogHost)
  vnode.appContext = context
  render(vnode, document.createElement('div'))
}

/**
 * Shows the dialog `load` resolves to with `props`. Resolves when it closes,
 * with the last value its `resultEvent` carried, or `undefined`.
 */
export async function presentDialog<Result>(
  context: AppContext,
  load: () => Promise<DialogModule>,
  props: Record<string, unknown>,
  resultEvent?: string,
): Promise<Result | undefined> {
  const component = (await load()).default
  mountHost(context)
  return new Promise((resolve) => {
    let result: Result | undefined
    const handlers = resultEvent
      ? { [`on${resultEvent[0].toUpperCase()}${resultEvent.slice(1)}`]: (value: Result) => { result = value } }
      : {}
    entries.value = [
      // Dialogs that closed earlier have finished leaving by now.
      ...entries.value.filter((entry) => entry.open),
      { id: nextId++, component, props: { ...props, ...handlers }, open: true, settle: () => resolve(result) },
    ]
  })
}
