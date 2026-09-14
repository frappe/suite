import { nextTick, ref } from 'vue'
import { renamingEntity, stopRename } from '@/apps/drive/data/selection'
import { rename } from '@/apps/drive/ui/drive/js/resources'

// Types whose name is edited whole — they carry no user-facing extension.
const KEEP_WHOLE_TYPES = ['Document', 'Markdown', 'Link']

// Length of the base name (everything before the extension). Used to pre-select
// just the name on focus, leaving the extension visible but untouched — the
// behaviour of Finder/Explorer inline rename.
function baseNameLength(entity) {
  const name = entity.file_name || ''
  if (entity.is_folder || KEEP_WHOLE_TYPES.includes(entity.file_type)) {
    return name.length
  }
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name.length : dot
}

// Inline rename for a single entity (a list row, grid tile, or breadcrumb).
// `source` is the entity object or a getter returning it (breadcrumb entities
// can load asynchronously). The entity is mutated optimistically so every view
// bound to it updates.
const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()

// Window after opening during which any focus loss is treated as a transient
// steal to be reclaimed rather than a commit. Comfortably covers the tick or two
// it takes the trigger (a removed breadcrumb button, a closing menu) to settle.
const OPEN_GRACE_MS = 600

export function useInlineRename(source) {
  const entity = () => (typeof source === 'function' ? source() : source)
  const draft = ref('')
  const input = ref(null)
  let openedAt = 0

  function selectBaseName() {
    const e = entity()
    const el = input.value
    if (!e || !el) return
    el.setSelectionRange(0, baseNameLength(e))
  }

  function focusAndSelect(e) {
    const el = input.value
    if (!el || renamingEntity.value !== e.name) return
    if (document.activeElement !== el) el.focus()
    el.setSelectionRange(0, baseNameLength(e))
  }

  function start() {
    const e = entity()
    if (!e) return
    draft.value = e.file_name || ''
    openedAt = now()
    // Focus + select once the input is in the DOM. Re-assert on a macrotask and
    // a frame in case something reclaims focus a tick later.
    nextTick(() => focusAndSelect(e))
    if (typeof setTimeout === 'function') setTimeout(() => focusAndSelect(e), 0)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => focusAndSelect(e))
    }
  }

  // A breadcrumb rename is triggered by clicking the crumb, whose button is then
  // removed from the DOM — that drops focus (to <body>, or wherever the app's
  // focus management sends it) right after we focus the input. Committing on
  // that transient blur would exit edit mode instantly ("selects then instantly
  // deselects"). So within the grace window right after opening, ANY focus loss
  // reclaims focus instead of committing; after it settles, a real click-away
  // still commits.
  function blur() {
    const e = entity()
    if (!e || renamingEntity.value !== e.name) return
    if (now() - openedAt < OPEN_GRACE_MS) {
      // Reclaim on the next tick so the browser finishes moving focus first.
      nextTick(() => focusAndSelect(e))
      return
    }
    submit()
  }

  function submit() {
    const e = entity()
    if (!e || renamingEntity.value !== e.name) return
    const title = draft.value.trim()
    stopRename()
    if (!title || title === e.file_name) return
    const previous = e.file_name
    e.file_name = title
    rename.submit(
      { entity_name: e.name, new_title: title },
      { onError: () => (e.file_name = previous) }
    )
  }

  return { draft, input, start, submit, blur, selectBaseName, cancel: stopRename }
}
