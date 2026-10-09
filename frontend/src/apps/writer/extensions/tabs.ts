import type { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment, Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Plugin, PluginKey, TextSelection, type PluginSpec } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import { ySyncPluginKey } from '@tiptap/y-tiptap'
import { v4 } from 'uuid'

import { TabNode } from '@/apps/writer/schema'

import TabView from './components/TabView.vue'

type TabMatch = { node: PMNode; pos: number }

declare module '@tiptap/core' {
  interface Storage {
    tab: { activeTabId: string | null }
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

// Content outside any tab node shows as the first tab, so creating a tab only
// appends one and never moves content someone else may be typing in
export const FIRST_TAB_ID = 'main'
// HTML is read back as real tabs, so the copy must not claim the first tab's id
const FIRST_TAB_HTML_ID = 'first-tab'
const FIRST_TAB_LABEL = 'firstTabLabel'

const firstTabBlocks = (doc: PMNode): TabMatch[] => {
  const blocks: TabMatch[] = []
  const collect = (node: PMNode, pos: number) => {
    if (node.type.name !== 'tab') {
      blocks.push({ node, pos })
    }
  }
  doc.forEach(collect)

  return blocks
}

const metaMap = (state: EditorState) => ySyncPluginKey.getState(state)?.doc?.getMap('meta')

const firstTabLabel = (state: EditorState): string | null =>
  metaMap(state)?.get(FIRST_TAB_LABEL) ?? null

export const tabIdAt = (doc: PMNode, pos: number): string => {
  const $pos = doc.resolve(pos)
  const block = $pos.depth ? $pos.node(1) : null
  if (block?.type.name !== 'tab') {
    return FIRST_TAB_ID
  }

  return block.attrs.id
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
  const hasFirstTab = blocks.length > 0
  const needsOwnTab = ordered.length > 0 || !!firstTabLabel
  if (hasFirstTab && needsOwnTab) {
    const firstTabAttrs = {
      id: FIRST_TAB_HTML_ID,
      label: firstTabLabel ?? 'Untitled',
    }
    const firstTab = doc.type.schema.nodes.tab.create(firstTabAttrs, blocks)
    children.unshift(firstTab)
  } else {
    children = [...blocks, ...children]
  }

  const serializer = DOMSerializer.fromSchema(doc.type.schema)
  const wrapper = document.createElement('div')
  wrapper.appendChild(serializer.serializeFragment(Fragment.fromArray(children)))
  return wrapper.innerHTML
}

/** The HTML of the open tab, or of the whole document when no tab is open. */
export const currentTabHTML = (editor: Editor): string => {
  const { state } = editor
  const activeTabId = editor.storage.tab?.activeTabId
  const serializer = DOMSerializer.fromSchema(state.schema)
  const wrapper = document.createElement('div')

  if (activeTabId === FIRST_TAB_ID) {
    const blocks = firstTabBlocks(state.doc).map(({ node }) => node)
    const blocksFragment = Fragment.from(blocks)
    const blocksDom = serializer.serializeFragment(blocksFragment)
    wrapper.appendChild(blocksDom)
    return wrapper.innerHTML
  }

  const tab = activeTabId ? findTab(state.doc, activeTabId) : null
  if (!tab) return editor.getHTML()

  wrapper.appendChild(serializer.serializeNode(tab.node))
  return wrapper.innerHTML
}

const duplicateTabIds = (doc: PMNode): string[] => {
  const ids = tabsIn(doc).map(({ node }) => node.attrs.id)
  return ids.filter((id, index) => !id || ids.indexOf(id) < index)
}

export const TabsExtension = TabNode.extend({
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

  addNodeView() {
    return VueNodeViewRenderer(TabView)
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    const hideFirstTab = (state: EditorState) => {
      const active = storage.activeTabId
      if (!active || active === FIRST_TAB_ID) return null

      const hide = ({ node, pos }: TabMatch) =>
        Decoration.node(pos, pos + node.nodeSize, { style: 'display: none' })
      const hidden = firstTabBlocks(state.doc).map(hide)
      return DecorationSet.create(state.doc, hidden)
    }

    const firstTabVisibility: PluginSpec<unknown> = {
      key: new PluginKey('firstTabVisibility'),
      props: { decorations: hideFirstTab },
    }

    return [
      new Plugin(firstTabVisibility),
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
    this.editor.getHTML = () => {
      const { state } = this.editor
      const label = firstTabLabel(state)
      return orderedHTML(state.doc, label)
    }
  },

  onCreate() {
    const meta = metaMap(this.editor.state)
    if (meta) {
      const announce = () => this.editor.view.dom.dispatchEvent(new CustomEvent('tab-renamed'))
      meta.observe(announce)
      this.storage.stopAnnouncing = () => meta.unobserve(announce)
    }

    // Also runs when the active tab disappears, such as the first tab of an
    // empty editor once a tabbed document loads into it
    const selectFirstTab = () => {
      const tabs = listTabs(this.editor).map((tab) => tab.id)
      if (tabs.includes(this.storage.activeTabId)) return

      let tabToChange = window.location.hash.slice(1)
      if (!tabs.includes(tabToChange)) {
        tabToChange = tabs[0]
      }
      if (tabToChange) {
        this.editor.commands.changeTab(tabToChange, false)
      }
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
          if (firstTabBlocks(state.doc).length) {
            newIndex--
          }
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
          const { doc } = this.editor.state
          const tab = tabId === FIRST_TAB_ID ? firstTabBlocks(doc)[0] : findTab(doc, tabId)
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
            if (refocus) {
              this.editor.commands.focusTab(tabId)
            }
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
        if (activeTabId === FIRST_TAB_ID) {
          const blocks = firstTabBlocks(state.doc)
          if (!tabsIn(state.doc).length || !blocks.length) return false

          const last = blocks[blocks.length - 1]
          const from = state.doc.resolve(blocks[0].pos)
          const to = state.doc.resolve(last.pos + last.node.nodeSize)
          const firstTabContent = TextSelection.between(from, to)
          view.dispatch(state.tr.setSelection(firstTabContent))
          return true
        }

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

export const listTabs = (editor: Editor): { id: string; label: string }[] => {
  const { doc } = editor.state
  const tabEntry = ({ node }: TabMatch) => ({
    id: node.attrs.id,
    label: node.attrs.label,
  })
  const tabs = orderedTabs(doc).map(tabEntry)
  if (!firstTabBlocks(doc).length) return tabs

  const firstTab = {
    id: FIRST_TAB_ID,
    label: firstTabLabel(editor.state) ?? 'Untitled',
  }
  return [firstTab, ...tabs]
}
