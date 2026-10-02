import { defaultKeymap } from '@codemirror/commands'
import { openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import { codeChrome, codeHighlight, codeKeymap, loadLanguage } from 'frappe-ui/code-editor'

import type { TextLanguage } from '../../internal/previewKind'

export interface CodeView {
  /** Focuses the text and opens the find bar. */
  find(): void
  /** True when focus is inside the view, find bar included. */
  hasFocus(): boolean
  destroy(): void
}

/**
 * A read-only CodeMirror view of `text`. The text can be focused, selected and
 * searched, but not changed. Escape gives focus back to the page, so the arrow
 * keys step between files again.
 */
export async function mountCodeView(
  parent: HTMLElement,
  { text, language, label }: { text: string; language: TextLanguage; label: string },
): Promise<CodeView> {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.phrases.of(PHRASES),
        // `inputmode` keeps a phone's keyboard closed when the text is tapped.
        EditorView.contentAttributes.of({ 'aria-label': label, inputmode: 'none' }),
        // The frappe-ui code box, colors and keys. Its Escape closes the find
        // bar first, then blurs. Its Tab indents only an editable document, so
        // here Tab moves focus as usual.
        codeChrome,
        codeHighlight,
        codeKeymap,
        lineNumbers(),
        highlightSpecialChars(),
        search({ top: true }),
        keymap.of([...searchKeymap, ...defaultKeymap]),
        language === 'markdown' || language === 'plain' ? EditorView.lineWrapping : [],
        (await languageSupport(language)) ?? [],
        theme,
      ],
    }),
  })
  return {
    find() {
      view.focus()
      openSearchPanel(view)
    },
    hasFocus: () => view.dom.contains(document.activeElement),
    destroy: () => view.destroy(),
  }
}

// Each language loads on first use, in its own chunk. frappe-ui has no
// TypeScript grammar, and its JavaScript one leaves out JSX, so those two load here.
async function languageSupport(language: TextLanguage): Promise<Extension | null> {
  switch (language) {
    case 'javascript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true })
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true })
    case 'plain':
      return null
    default:
      return loadLanguage(language)
  }
}

// The find bar's labels, in the app's sentence case.
const PHRASES = {
  next: 'Next',
  previous: 'Previous',
  all: 'All',
  'match case': 'Match case',
  regexp: 'Regex',
  'by word': 'Whole word',
  close: 'Close',
}

// The frappe-ui box fills the pane here: the page's surface, no corners and no
// focus ring. The find bar is CodeMirror's own, so it gets the app's look here.
const theme = EditorView.theme({
  '&': {
    height: '100%',
    '--code-bg': 'var(--surface-base)',
    '--code-radius': '0',
    '--code-focus-ring': 'transparent',
    '--code-padding-y': '12px',
    '--code-padding-x': '12px',
  },
  '.cm-scroller': { lineHeight: '1.6' },
  '.cm-gutters': { color: 'var(--ink-gray-4)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 16px' },
  '.cm-panels': { backgroundColor: 'var(--surface-gray-1)', color: 'var(--ink-gray-8)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--outline-gray-1)' },
  '.cm-search': { fontFamily: 'inherit', fontSize: '13px', padding: '6px 12px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  '.cm-search br': { display: 'none' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ink-gray-7)' },
  '.cm-textfield': {
    margin: '0',
    padding: '2px 8px',
    border: '1px solid var(--outline-gray-2)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface-base)',
    color: 'var(--ink-gray-8)',
    fontSize: '13px',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--outline-gray-4)' },
  '.cm-button': {
    margin: '0',
    padding: '2px 8px',
    border: 'none',
    borderRadius: '6px',
    backgroundImage: 'none',
    backgroundColor: 'var(--surface-gray-2)',
    color: 'var(--ink-gray-8)',
    fontSize: '13px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--surface-gray-3)' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--ink-gray-5)', top: '6px', right: '8px', fontSize: '16px' },
  '.cm-searchMatch': { backgroundColor: 'var(--surface-amber-2)', outline: 'none' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--surface-amber-3)' },
})
