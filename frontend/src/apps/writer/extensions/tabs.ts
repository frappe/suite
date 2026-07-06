import { Node } from '@tiptap/core'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import TabView from './components/TabView.vue'
import { TextSelection } from '@tiptap/pm/state'
import { DOMSerializer } from '@tiptap/pm/model'
import { v4 } from 'uuid'

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

  onCreate() {
    const selectFirstTab = () => {
      if (this.storage.hasInitialized) return

      const { doc } = this.editor.state
      let tabToChange = window.location.hash.slice(1)
      const tabs = []
      doc.descendants(
        (node) => node.type.name === 'tab' && tabs.push(node.attrs.id),
      )
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
          const tabs = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'tab') {
              tabs.push({ node, pos })
            }
          })

          // Find the tab to move
          const tabIndex = tabs.findIndex((t) => t.node.attrs.id === tabId)
          if (tabIndex === -1) return false

          // Validate new index
          if (newIndex < 0 || newIndex > tabs.length || newIndex === tabIndex) {
            return false
          }

          const { node, pos } = tabs[tabIndex]
          const size = node.nodeSize
          tr.delete(pos, pos + size)

          let insertPos
          let i = 0
          tr.doc.descendants((n, p) => {
            if (insertPos !== undefined) return false
            if (n.type.name === 'tab') {
              if (i === newIndex) {
                insertPos = p
                return false
              }
              i++
            }
          })

          // Delete the tab from its current position
          if (insertPos === undefined) insertPos = tr.doc.content.size
          tr.insert(insertPos, node)

          dispatch(tr)

          // Keep focus on the moved tab
          setTimeout(() => {
            this.editor.commands.changeTab(tabId, false)
          }, 0)

          return true
        },
      focusTab:
        (tabId: string) =>
        ({ state }) => {
          setTimeout(() => {
            let focusPos = null
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'tab' && node.attrs.id === tabId) {
                focusPos = pos + 1
                return false
              }
            })
            if (focusPos !== null) this.editor.commands.focus(focusPos)
          }, 0)
        },
      renameTab:
        (tabId: string, newLabel: string, refocus: boolean = true) =>
        ({ tr, dispatch, state }) => {
          if (!dispatch) return false

          let updated = false
          state.doc.descendants((node, pos) => {
            if (node.type.name === 'tab' && node.attrs.id === tabId) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                label: newLabel,
              })
              updated = true
              return false
            }
          })

          if (updated) {
            dispatch(tr)
            if (refocus) this.editor.commands.focusTab(tabId)
            return true
          }
          return false
        },
      deleteTab:
        (tabId: string) =>
        ({ tr, dispatch, state }) => {
          if (!dispatch) return false

          let deleted = false

          state.doc.descendants((node, pos) => {
            if (node.type.name === 'tab' && node.attrs.id === tabId) {
              tr.delete(pos, pos + node.nodeSize)
              deleted = true
              return false
            }
          })

          if (deleted) {
            if (this.storage.activeTabId === tabId) {
              let newActiveTabId = null
              tr.doc.descendants((node) => {
                if (node.type.name === 'tab' && !newActiveTabId) {
                  newActiveTabId = node.attrs.id
                  return false
                }
              })
              return this.editor.commands.changeTab(newActiveTabId)
            }
          }
          return false
        },
      wrapInTab:
        (attrs: { id?: string; label?: string } = {}) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            if (!attrs?.id) attrs.id = v4()
            const tabType = this.editor.schema.nodes.tab
            tr.replaceWith(
              0,
              tr.doc.content.size,
              tabType.create(attrs, tr.doc.content),
            )
            this.storage.activeTabId = attrs.id
            dispatch(tr)
            return true
          }
          return false
        },
      createTab:
        (attrs: { id?: string; label?: string } = {}) =>
        ({ tr, dispatch, state }) => {
          if (dispatch) {
            if (!attrs.id) attrs.id = v4()
            if (!attrs.label) attrs.label = 'Untitled'

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

          let html: string | boolean = false
          state.doc.descendants((node) => {
            if (
              node.type.name === 'tab' &&
              node.attrs.id === this.storage.activeTabId
            ) {
              const dom = serializer.serializeNode(node)
              const wrapper = document.createElement('div')
              wrapper.appendChild(dom)
              html = wrapper.innerHTML
              return false
            }
          })
          return html === false ? this.editor.getHTML() : html
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-a': () => {
        const activeTabId = this.storage.activeTabId
        if (!activeTabId) return false

        const { state, view } = this.editor
        let tabStart = null
        let tabEnd = null

        state.doc.descendants((node, pos) => {
          if (node.type.name === 'tab' && node.attrs.id === activeTabId) {
            tabStart = pos + 1
            tabEnd = pos + node.nodeSize - 1
            return false
          }
        })

        if (tabStart !== null && tabEnd !== null) {
          const tr = state.tr.setSelection(
            TextSelection.create(state.doc, tabStart, tabEnd),
          )
          view.dispatch(tr)
          return true
        }

        return false
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

        state.doc.descendants((node, pos) => {
          if (
            node.type.name === 'tab' &&
            pos < $from.pos &&
            $from.pos < pos + node.nodeSize
          ) {
            tabNode = node
            tabPos = pos
            return false
          }
        })

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
