import { defineComponent, h, render, shallowRef, type AppContext } from 'vue'

import NewEventDialog from '@/apps/calendar/components/NewEventDialog.vue'
import type { NewEventDraft } from '@/apps/calendar/utils/newEventDraft'

/**
 * Opens Calendar's new-event form by function call, so another area never renders Calendar's form
 * or binds its props. A host, mounted on an app's first call, renders it inside that app's context,
 * so the router, the stores and the server-state cache are the page's own. The host sits in the
 * document's body: the phone's form is a fixed screen of its own, not a portal, and inside the
 * caller's page a transformed or stacked ancestor would hold it.
 */

interface Host {
  show(draft: NewEventDraft): Promise<void>
}

const hosts = new WeakMap<AppContext, Host>()

function mountHost(context: AppContext): Host {
  const draft = shallowRef<NewEventDraft | null>(null)
  let settle: (() => void) | undefined
  const close = () => {
    settle?.()
    settle = undefined
  }
  const vnode = h(
    defineComponent({
      name: 'NewEventDialogHost',
      setup: () => () =>
        h(NewEventDialog, {
          modelValue: draft.value,
          'onUpdate:modelValue': (value: NewEventDraft | null) => {
            draft.value = value
            if (!value) close()
          },
        }),
    }),
  )
  vnode.appContext = context
  const element = document.createElement('div')
  document.body.append(element)
  render(vnode, element)
  // The host goes with its app.
  context.app.onUnmount(() => {
    render(null, element)
    element.remove()
    hosts.delete(context)
  })
  return {
    show: (next) => {
      // One form at a time: a second ask, which the first form's overlay leaves no way to make,
      // replaces it.
      close()
      draft.value = next
      return new Promise((resolve) => (settle = resolve))
    },
  }
}

/** Shows the form filled in from `draft`. Resolves when it closes, saved or not. */
export function presentNewEventDialog(context: AppContext, draft: NewEventDraft): Promise<void> {
  let host = hosts.get(context)
  if (!host) hosts.set(context, (host = mountHost(context)))
  return host.show(draft)
}
