// Where the grid's keyboard focus really lives: a hidden <textarea>.
//
// A focused <canvas> only gets keydown. Text that arrives without one never
// reaches it: an IME composition (Hindi, Marathi, Japanese…), the Windows
// emoji/symbol picker, a phone keyboard, a dead key, CDP insertText. So the
// grid keeps focus here instead, as Google Sheets does, and:
//   - focusing the canvas (clicks, refocus after a dialog) lands here;
//   - each keydown is fired again on the canvas, so the grid's keys and the
//     app's shortcuts see the event they always did (frappe-ui skips
//     shortcuts whose target is a textarea);
//   - text from an `input` event or a finished composition starts the edit.
// While a composition runs, the textarea sits over the active cell, so the
// IME's text and candidate window show there.

export interface TextSinkOptions {
  /** The grid wrapper; the textarea goes inside it (clipboard targeting relies on that). */
  parent: HTMLElement
  canvas: HTMLElement
  /** The active cell, in CSS pixels inside `parent`. */
  activeRect(): { x: number; y: number; w: number; h: number }
  /** False for a viewer: a composition then stays hidden (its text is dropped anyway). */
  canEdit(): boolean
  /** Text arrived without a keydown: start an edit with it. */
  onText(text: string): void
}

export interface TextSink {
  el: HTMLTextAreaElement
  destroy(): void
}

const HIDDEN = [
  'position:absolute',
  'left:0',
  'top:0',
  'width:1px',
  'height:1px',
  'padding:0',
  'border:0',
  'margin:0',
  'opacity:0',
  'resize:none',
  'overflow:hidden',
  'white-space:pre',
  'pointer-events:none',
  'outline:none',
  'z-index:-1',
].join(';')

// Keys that belong to an IME composition, or to a keyboard that only tells us
// what it typed in the input event that follows (Android: "Unidentified").
// Safari sends the Enter that confirms a candidate with isComposing false,
// so keyCode 229 (deprecated, but the only signal there) counts too.
function isImeKey(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Unidentified'
}

export function createTextSink(o: TextSinkOptions): TextSink {
  const { canvas } = o
  const el = document.createElement('textarea')
  el.tabIndex = -1
  el.spellcheck = false
  el.autocomplete = 'off'
  el.setAttribute('autocorrect', 'off')
  el.setAttribute('autocapitalize', 'off')
  el.style.cssText = HIDDEN
  o.parent.appendChild(el)

  function onCanvasFocus(): void {
    el.focus({ preventScroll: true })
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (isImeKey(e)) return
    const copy = new KeyboardEvent('keydown', {
      key: e.key,
      code: e.code,
      location: e.location,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      bubbles: true,
      cancelable: true,
    })
    // Only the copy travels on, so nothing handles the key twice.
    e.stopPropagation()
    if (!canvas.dispatchEvent(copy)) e.preventDefault()
  }

  function take(): string {
    const text = el.value
    el.value = ''
    return text
  }

  // Between compositionstart and compositionend the text is the IME's, even
  // when an input says otherwise (Firefox and some Android keyboards send the
  // committed text with isComposing false before compositionend).
  let composing = false

  function onInput(e: Event): void {
    if (composing || (e as InputEvent).isComposing) return
    const type = (e as InputEvent).inputType
    const text = take()
    // A paste or drop is the clipboard code's job (document listeners).
    if (!text || type === 'insertFromPaste' || type === 'insertFromDrop') return
    o.onText(text)
  }

  function onCompositionStart(): void {
    composing = true
    if (!o.canEdit()) return
    const r = o.activeRect()
    el.style.left = r.x + 'px'
    el.style.top = r.y + 'px'
    el.style.width = r.w + 'px'
    el.style.height = r.h + 'px'
    el.style.padding = '0 4px'
    el.style.font = '13px InterVar,Inter,ui-sans-serif,system-ui,sans-serif'
    el.style.background = 'var(--surface-base, #FFFFFF)'
    el.style.opacity = '1'
    el.style.zIndex = '10'
  }

  // `data` is the committed text; empty when the user cancelled (Esc).
  function onCompositionEnd(e: CompositionEvent): void {
    composing = false
    el.style.cssText = HIDDEN
    take()
    if (e.data) o.onText(e.data)
  }

  canvas.addEventListener('focus', onCanvasFocus)
  el.addEventListener('keydown', onKeyDown)
  el.addEventListener('input', onInput)
  el.addEventListener('compositionstart', onCompositionStart)
  el.addEventListener('compositionend', onCompositionEnd)

  return {
    el,
    destroy() {
      canvas.removeEventListener('focus', onCanvasFocus)
      el.removeEventListener('keydown', onKeyDown)
      el.removeEventListener('input', onInput)
      el.removeEventListener('compositionstart', onCompositionStart)
      el.removeEventListener('compositionend', onCompositionEnd)
      el.remove()
    },
  }
}
