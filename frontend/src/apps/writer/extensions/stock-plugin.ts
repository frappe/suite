import type { Plugin } from '@tiptap/pm/state'

// The one plugin a frappe-ui extension adds, for an override to wrap
export function stockPlugin(parent: (() => Plugin[]) | undefined) {
  const [plugin] = parent?.() ?? []
  if (!plugin) {
    throw new Error('The stock extension adds no plugin to wrap')
  }

  return plugin
}
