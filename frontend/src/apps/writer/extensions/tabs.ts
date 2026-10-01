import { Node, type Editor } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import TabView from './components/TabView.vue'
import { EditorState, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { DOMSerializer, Fragment, Node as PMNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { v4 } from 'uuid'

type TabMatch = { node: PMNode; pos: number }

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

// Content outside any tab node shows as the first tab, so creating a tab only
// appends one and never moves content someone else may be typing in
export const FIRST_TAB_ID = 'main'
const FIRST_TAB_LABEL = 'firstTabLabel'

const firstTabBlocks = (doc: PMNode): TabMatch[] => {
  const blocks: TabMatch[] = []
  doc.forEach((node, offset) => {
    if (node.type.name !== 'tab') blocks.push({ node, pos: offset })
  })
  return blocks
}

const metaMap = (state: EditorState) =>
  ySyncPluginKey.getState(state)?.doc?.getMap('meta')

const firstTabLabel = (state: EditorState): string | null =>
  metaMap(state)?.get(FIRST_TAB_LABEL) ?? null

export const tabIdAt = (doc: PMNode, pos: number): string => {
  const $pos = doc.resolve(pos)
  const block = $pos.depth ? $pos.node(1) : null
  return block?.type.name === 'tab' ? block.attrs.id : FIRST_TAB_ID
}

// Tabs are ordered by attribute, not by position: moving a node is a delete
// plus an insert, which Yjs cannot merge as a move
export const orderedTabs = (doc: PMNode): TabMatch[] =>
  tabsIn(doc)
    .map((tab, index) => ({ tab, index, order: tab.node.attrs.order ?? index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ tab }) => tab)

// Document order is no longer tab order, so serialise the tab slots in display
// order. The first tab is written as a tab of its own whenever its label or
// other tabs would otherwise be lost from the HTML
const orderedHTML = (doc: PMNode, firstTabLabel: string | null): string => {
  const ordered = orderedTabs(doc)
  const blocks = firstTabBlocks(doc).map(({ node }) => node)
  let children: PMNode[] = ordered.map(({ node }) => node)
  if (blocks.length && (ordered.length || firstTabLabel)) {
    const label = firstTabLabel ?? 'Untitled'
    children.unshift(doc.type.schema.nodes.tab.create({ id: FIRST_TAB_ID, label }, blocks))
  } else {
    children = [...blocks, ...children]
  }

  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const wrapper = document.createElement('div')
  wrapper.appendChild(serializer.serializeFragment(Fragment.fromArray(children)))
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
        renderHTML: (attrs) =>
          attrs.order === null ? {} : { 'data-tab-order': attrs.order },
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
    const storage = this.storage
    return [
      new Plugin({
        key: new PluginKey('firstTabVisibility'),
        props: {
          decorations: (state) => {
            const active = storage.activeTabId
            if (!active || active === FIRST_TAB_ID) return null
            return DecorationSet.create(
              state.doc,
              firstTabBlocks(state.doc).map(({ node, pos }) =>
                Decoration.node(pos, pos + node.nodeSize, { style: 'display: none' }),
              ),
            )
          },
        },
      }),
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
    this.editor.getHTML = () =>
      orderedHTML(this.editor.state.doc, firstTabLabel(this.editor.state))
  },

  onCreate() {
    const meta = metaMap(this.editor.state)
    if (meta) {
      const announce = () =>
        this.editor.view.dom.dispatchEvent(new CustomEvent('tab-renamed'))
      meta.observe(announce)
      this.storage.stopAnnouncing = () => meta.unobserve(announce)
    }

    // Also runs when the active tab disappears, such as the first tab of an
    // empty editor once a tabbed document loads into it
    const selectFirstTab = () => {
      const tabs = listTabs(this.editor).map((tab) => tab.id)
      if (tabs.includes(this.storage.activeTabId)) return

      let tabToChange = window.location.hash.slice(1)
      if (!tabs.includes(tabToChange)) tabToChange = tabs[0]
      if (tabToChange) this.editor.commands.changeTab(tabToChange, false)
    }

    selectFirstTab()
    // BROKEN: somehow stop constant re-firing of this
    this.editor.on('update', selectFirstTab)
  },

  onDestroy() {
    this.storage.stopAnnouncing?.()
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
          if (firstTabBlocks(state.doc).length) newIndex--
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
      focusTab:
        (tabId: string) =>
        () => {
          setTimeout(() => {
            const { doc } = this.editor.state
            const tab =
              tabId === FIRST_TAB_ID ? firstTabBlocks(doc)[0] : findTab(doc, tabId)
            if (tab) this.editor.commands.focus(tab.pos + 1)
          }, 0)
          return true
        },
      renameTab:
        (tabId: string, newLabel: string, refocus: boolean = true) =>
        ({ tr, dispatch, state }) => {
          if (tabId === FIRST_TAB_ID) {
            const meta = metaMap(state)
            if (!meta) return false
            if (!dispatch) return true
            meta.doc!.transact(() => meta.set(FIRST_TAB_LABEL, newLabel), this.name)
            if (refocus) this.editor.commands.focusTab(tabId)
            return true
          }

          const tab = findTab(state.doc, tabId)
          if (!tab) return false
          if (!dispatch) return true

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

          if (tabId === FIRST_TAB_ID) {
            if (!tabsIn(state.doc).length) return false
            firstTabBlocks(state.doc)
              .reverse()
              .forEach(({ node, pos }) => tr.delete(pos, pos + node.nodeSize))
          } else {
            const tab = findTab(state.doc, tabId)
            if (!tab) return false
            tr.delete(tab.pos, tab.pos + tab.node.nodeSize)
          }
          dispatch(tr)

          if (this.storage.activeTabId === tabId) {
            const next = listTabs(this.editor)[0]
            this.editor.commands.changeTab(next ? next.id : null)
          }
          return true
        },
      createTab:
        (attrs: { id?: string; label?: string; order?: number } = {}) =>
        ({ tr, dispatch, state }) => {
          if (dispatch) {
            if (!attrs.id) attrs.id = v4()
            if (!attrs.label) attrs.label = 'Untitled'
            if (attrs.order === undefined) attrs.order = tabsIn(state.doc).length

            const paragraphType = this.editor.schema.nodes.paragraph
            const tab = this.editor.schema.nodes.tab.create(
              attrs,
              paragraphType.create(),
            )
            tr.insert(state.doc.content.size, tab)
            dispatch(tr)

            setTimeout(() => this.editor.commands.changeTab(attrs.id), 10)
          }
          return true
        },
      getCurrentTabHTML:
        () =>
        ({ state }) => {
          const serializer = DOMSerializer.fromSchema(state.schema)
          const wrapper = document.createElement('div')
          if (this.storage.activeTabId === FIRST_TAB_ID) {
            const blocks = firstTabBlocks(state.doc).map(({ node }) => node)
            wrapper.appendChild(serializer.serializeFragment(Fragment.from(blocks)))
            return wrapper.innerHTML
          }

          const tab = findTab(state.doc, this.storage.activeTabId)
          if (!tab) return this.editor.getHTML()

          wrapper.appendChild(serializer.serializeNode(tab.node))
          return wrapper.innerHTML
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const activeTabId = this.storage.activeTabId
        if (!activeTabId) return false

        const { state, view } = this.editor
        if (activeTabId === FIRST_TAB_ID) {
          const [first] = tabsIn(state.doc)
          if (!first) return false
          view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, 1, first.pos - 1)),
          )
          return true
        }
        const tab = findTab(state.doc, activeTabId)
        if (!tab) return false

        view.dispatch(
          state.tr.setSelection(
            TextSelection.create(
              state.doc,
              tab.pos + 1,
              tab.pos + tab.node.nodeSize - 1,
            ),
          ),
        )
        return true
      },
      Backspace: () => {
        // prevent clearing of document when tab is empty
        const { $to } = this.editor.state.selection
        if ($to.parent.type.name === 'tab' && $to.parent.content.size == 2)
          return true
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

        if (
          !tabNode ||
          tabNode.attrs.label !== 'Untitled' ||
          !tabNode.content.firstChild
        )
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

export const listTabs = (editor: Editor): { id: string; label: string }[] => {
  const { doc } = editor.state
  const tabs = orderedTabs(doc).map(({ node }) => ({
    id: node.attrs.id,
    label: node.attrs.label,
  }))
  if (!firstTabBlocks(doc).length) return tabs
  const label = firstTabLabel(editor.state) ?? 'Untitled'
  return [{ id: FIRST_TAB_ID, label }, ...tabs]
}
