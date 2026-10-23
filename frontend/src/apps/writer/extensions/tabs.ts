import { Node, type Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { v4 } from 'uuid'

import TabView from './components/TabView.vue'

type TabMatch = { node: PMNode; pos: number }

declare module '@tiptap/core' {
  interface Storage {
    tab: { activeTabId: string | null; hasInitialized: boolean }
  }
}

// Tabs are always direct children of the doc
export const tabsIn = (doc: PMNode): TabMatch[] => {
  const tabs: TabMatch[] = []
  doc.forEach((node, offset) => {
    if (node.type.name === 'tab') tabs.push({ node, pos: offset })
  })
  return tabs
}

export const findTab = (doc: PMNode, id: string): TabMatch | null =>
  tabsIn(doc).find((tab) => tab.node.attrs.id === id) || null

// Tabs are ordered by attribute, not by position: moving a node is a delete
// plus an insert, which Yjs cannot merge as a move
export const orderedTabs = (doc: PMNode): TabMatch[] =>
  tabsIn(doc)
    .map((tab, index) => ({ tab, index, order: tab.node.attrs.order ?? index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ tab }) => tab)

// Document order is no longer tab order, so serialise the tab slots in display
// order
const orderedHTML = (doc: PMNode): string => {
  const ordered = orderedTabs(doc)
  let next = 0
  const children: PMNode[] = []
  doc.forEach((node) => children.push(node.type.name === 'tab' ? ordered[next++].node : node))

  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const wrapper = document.createElement('div')
  wrapper.appendChild(serializer.serializeFragment(Fragment.fromArray(children)))
  return wrapper.innerHTML
}

/** The HTML of the open tab, or of the whole document when no tab is open. */
export const currentTabHTML = (editor: Editor): string => {
  const activeTabId = editor.storage.tab?.activeTabId
  const tab = activeTabId ? findTab(editor.state.doc, activeTabId) : null
  if (!tab) return editor.getHTML()

  const serializer = DOMSerializer.fromSchema(editor.state.schema)
  const wrapper = document.createElement('div')
  wrapper.appendChild(serializer.serializeNode(tab.node))
  return wrapper.innerHTML
}

const duplicateTabIds = (doc: PMNode): string[] => {
  const ids = tabsIn(doc).map(({ node }) => node.attrs.id)
  return ids.filter((id, index) => !id || ids.indexOf(id) < index)
}

export const TabsExtension = Node.create({
  name: 'tab',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addStorage() {
    return {
      activeTabId: null,
      hasInitialized: false,
    }
  },

  addOptions() {
    return {
      ydoc: null,
    }
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-tab-id'),
        renderHTML: (attrs) => (attrs.id ? { 'data-tab-id': attrs.id } : {}),
      },
      label: {
        default: 'Untitled',
        parseHTML: (el) => el.getAttribute('data-tab-label'),
        renderHTML: (attrs) => ({ 'data-tab-label': attrs.label }),
      },
      order: {
        default: null,
        parseHTML: (el) => {
          const order = el.getAttribute('data-tab-order')
          return order === null ? null : Number(order)
        },
        renderHTML: (attrs) => (attrs.order === null ? {} : { 'data-tab-order': attrs.order }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-tab-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', HTMLAttributes, 0]
  },

  addNodeView() {
    return VueNodeViewRenderer(TabView)
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tabIntegrity'),
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true

          const added = duplicateTabIds(tr.doc)
          if (added.length <= duplicateTabIds(state.doc).length) return true

          console.error('Rejected transaction: duplicate tab ids', added, tr)
          // Yjs owns the doc; rejecting its sync would desync the editor
          return !!tr.getMeta(ySyncPluginKey)
        },
      }),
    ]
  },

  // `create` fires a tick late, so patch the serialiser before anything can
  // call it
  onBeforeCreate() {
    this.editor.getHTML = () => orderedHTML(this.editor.state.doc)
  },

  onCreate() {
    const selectFirstTab = () => {
      if (this.storage.hasInitialized) return

      const { doc } = this.editor.state
      let tabToChange = window.location.hash.slice(1)
      const tabs = orderedTabs(doc).map((tab) => tab.node.attrs.id)
      if (!tabToChange || !tabs.includes(tabToChange)) tabToChange = tabs[0]
      if (tabToChange) {
        this.storage.hasInitialized = true
        this.editor.commands.changeTab(tabToChange, false)
      }
    }

    selectFirstTab()
    // BROKEN: somehow stop constant re-firing of this
    this.editor.on('update', selectFirstTab)
  },

  onDestroy() {
    if (this.options.ydoc) {
      this.options.ydoc.off('sync', () => {})
    }
  },

  addCommands() {
    return {
      changeTab:
        (tabId: string, changed: boolean = true) =>
        ({ tr, dispatch }) => {
          if (this.editor.view.dom) {
            this.editor.view.dom.setAttribute('data-active-tab', tabId || '')
          }
          this.storage.activeTabId = tabId
          if (dispatch) {
            dispatch(tr)
          }

          if (changed) {
            this.editor.commands.focusTab(tabId)
            window.history.replaceState(null, '', '#' + tabId)
          }
          this.editor.view.dom.dispatchEvent(
            new CustomEvent('tab-changed', {
              detail: { tabId },
            }),
          )
          return true
        },
      reorderTab:
        (tabId: string, newIndex: number) =>
        ({ tr, dispatch, state }) => {
          const tabs = orderedTabs(state.doc)
          const tabIndex = tabs.findIndex((t) => t.node.attrs.id === tabId)

          if (tabIndex === -1 || tabIndex === newIndex) return false
          if (newIndex < 0 || newIndex >= tabs.length) return false
          if (!dispatch) return true

          tabs.splice(newIndex, 0, tabs.splice(tabIndex, 1)[0])
          tabs.forEach(({ node, pos }, index) => {
            if (node.attrs.order !== index) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, order: index })
            }
          })
          dispatch(tr)

          return true
        },
      focusTab: (tabId: string) => () => {
        setTimeout(() => {
          const tab = findTab(this.editor.state.doc, tabId)
          if (tab) this.editor.commands.focus(tab.pos + 1)
        }, 0)
        return true
      },
      renameTab:
        (tabId: string, newLabel: string, refocus: boolean = true) =>
        ({ tr, dispatch, state }) => {
          if (!dispatch) return false

          const tab = findTab(state.doc, tabId)
          if (!tab) return false

          tr.setNodeMarkup(tab.pos, undefined, {
            ...tab.node.attrs,
            label: newLabel,
          })
          dispatch(tr)
          if (refocus) this.editor.commands.focusTab(tabId)
          return true
        },
      deleteTab:
        (tabId: string) =>
        ({ tr, dispatch, state }) => {
          if (!dispatch) return false

          const tab = findTab(state.doc, tabId)
          if (!tab) return false

          tr.delete(tab.pos, tab.pos + tab.node.nodeSize)
          dispatch(tr)

          if (this.storage.activeTabId === tabId) {
            const next = tabsIn(tr.doc)[0]
            this.editor.commands.changeTab(next ? next.node.attrs.id : null)
          }
          return true
        },
      wrapInTab:
        (attrs: { id?: string; label?: string; order?: number } = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            if (!attrs?.id) attrs.id = v4()
            if (attrs.order === undefined) attrs.order = 0
            const tabType = this.editor.schema.nodes.tab
            tr.replaceWith(0, tr.doc.content.size, tabType.create(attrs, tr.doc.content))
            this.storage.activeTabId = attrs.id
            dispatch(tr)
            return true
          }
          return false
        },
      createTab:
        (attrs: { id?: string; label?: string; order?: number } = {}) =>
        ({ tr, dispatch, state }) => {
          if (dispatch) {
            if (!attrs.id) attrs.id = v4()
            if (!attrs.label) attrs.label = 'Untitled'
            if (attrs.order === undefined) attrs.order = tabsIn(state.doc).length

            const paragraphType = this.editor.schema.nodes.paragraph
            const tab = this.editor.schema.nodes.tab.create(attrs, paragraphType.create())
            tr.insert(state.doc.content.size, tab)
            dispatch(tr)

            setTimeout(() => this.editor.commands.changeTab(attrs.id), 10)
          }
          return true
        },
      getCurrentTabHTML: () => () => currentTabHTML(this.editor),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const activeTabId = this.storage.activeTabId
        if (!activeTabId) return false

        const { state, view } = this.editor
        const tab = findTab(state.doc, activeTabId)
        if (!tab) return false

        view.dispatch(
          state.tr.setSelection(
            TextSelection.create(state.doc, tab.pos + 1, tab.pos + tab.node.nodeSize - 1),
          ),
        )
        return true
      },
      Backspace: () => {
        // prevent clearing of document when tab is empty
        const { $to } = this.editor.state.selection
        if ($to.parent.type.name === 'tab' && $to.parent.content.size == 2) return true
      },
      Enter: () => {
        const { state } = this.editor
        const { selection } = state
        const { $from } = selection

        // Must be inside a tab
        let tabNode = null
        let tabPos = null

        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === 'tab') {
            tabNode = $from.node(depth)
            tabPos = $from.before(depth)
            break
          }
        }

        if (!tabNode || tabNode.attrs.label !== 'Untitled' || !tabNode.content.firstChild)
          return false

        const firstChildStart = tabPos + 1
        if ($from.before($from.depth) !== firstChildStart) return false

        // Let Enter happen first
        requestAnimationFrame(() => {
          const updatedTab = this.editor.state.doc.nodeAt(tabPos)
          const updatedFirst = updatedTab?.content.firstChild
          if (!updatedFirst) return

          const text = updatedFirst.textContent.trim()
          if (!text) return

          this.editor.commands.renameTab(tabNode.attrs.id, text, false)
        })

        return false
      },
    }
  },
})
