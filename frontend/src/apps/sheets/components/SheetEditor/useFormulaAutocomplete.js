import { ref, computed, watch, nextTick } from 'vue'
import { AC_FUNS, AC_FUN_KEYS, parseAcToken } from '../../utils/formula-ac.js'

export { AC_FUNS, parseAcToken }

/**
 * @param {{ formulaInputRef: import('vue').Ref, formulaValue: import('vue').Ref<string>, sheetNames: import('vue').Ref<string[]> }} opts
 */
export function useFormulaAutocomplete({ formulaInputRef, formulaValue, sheetNames }) {
  const acItems   = ref([])
  const acIdx     = ref(0)
  const acUp      = ref(false)
  const acVisible = computed(() => acItems.value.length > 0)

  function updateAc(value, cursor) {
    const result = parseAcToken(value, cursor)
    if (!result) { acItems.value = []; return }
    const up    = result.tok.toUpperCase()
    const fns   = AC_FUN_KEYS.filter(n => n.startsWith(up)).slice(0, 6)
    const sheets = (sheetNames.value || [])
      .filter(n => n.toUpperCase().startsWith(up) && !fns.includes(n.toUpperCase()))
      .slice(0, 3)
    acItems.value = [
      ...fns.map(name => ({ name, kind: 'fn' })),
      ...sheets.map(name => ({ name, kind: 'sheet' })),
    ]
    acIdx.value = 0
  }

  function commitAc(item) {
    const input = formulaInputRef.value
    if (!input) return
    const result = parseAcToken(input.value, input.selectionStart)
    if (!result) { acItems.value = []; return }
    const { tok: _tok, tokStart } = result
    const cursor = input.selectionStart
    // Functions get an auto-closed '()' with the caret landing inside; sheets
    // get a trailing '!'. Caret sits one char past the name in both cases.
    const suffix = item.kind === 'sheet' ? '!' : '()'
    formulaValue.value = input.value.slice(0, tokStart) + item.name + suffix + input.value.slice(cursor)
    nextTick(() => {
      const pos = tokStart + item.name.length + 1
      input.setSelectionRange(pos, pos)
    })
    acItems.value = []
  }

  function closeAc() { acItems.value = []; acUp.value = false }

  // After the list renders, flip it upward if it clips the viewport bottom.
  watch(acVisible, async visible => {
    if (!visible) { acUp.value = false; return }
    await nextTick()
    const el = typeof document !== 'undefined' ? document.querySelector('.sn-ac-list') : null
    if (el) acUp.value = el.getBoundingClientRect().bottom > window.innerHeight - 8
  })

  return { acItems, acIdx, acUp, acVisible, updateAc, commitAc, closeAc }
}
