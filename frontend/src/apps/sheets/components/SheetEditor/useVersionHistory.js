import { ref }          from 'vue'
import { parseCellId }  from '../../utils/cells.js'
import { unpackSheet }  from '../../utils/sheet-codec.js'
import * as _defaultApi from '../../services/versions.js'

// ── helpers ────────────────────────────────────────────────────────────────────

function flattenDiff(diff, parse) {
  if (!diff?.sheets) return []
  const out = []
  for (const [sheetName, cells] of Object.entries(diff.sheets)) {
    for (const id of Object.keys(cells)) out.push({ sheet: sheetName, id })
  }
  out.sort((a, b) => {
    const pa = parse(a.id), pb = parse(b.id)
    if (!pa || !pb) return 0
    return pa.row - pb.row || pa.col - pb.col
  })
  return out
}

function captureLiveState({ getCurrentTitle, getSheet, getFormats, getMerge,
                            getComments, getValidation, getCondFormat,
                            getSortFilter, getGrid }) {
  const sheet      = getSheet()
  const formats    = getFormats()
  const merge      = getMerge()
  const comments   = getComments()
  const validation = getValidation()
  const condFormat = getCondFormat()
  const sortFilter = getSortFilter()
  const grid       = getGrid()
  return {
    title:      getCurrentTitle(),
    sheetsData: {
      sheet:      sheet?.snapshot(),
      formats:    formats?.snapshot(),
      merge:      merge?.snapshot(),
      comments:   comments?.snapshot(),
      validation: validation?.snapshot(),
      condFormat: condFormat?.snapshot(),
      sortFilter: sortFilter?.snapshot(),
      view:       grid?.viewSnapshot?.() ?? null,
    },
  }
}

function applyEngineState(saved, title,
    { getSheet, getFormats, getMerge, getComments, getValidation,
      getCondFormat, getSortFilter, getGrid, getCurrentTitle,
      repopulateGrid, syncViewMirrors, syncNames, currentTitle }) {
  const sheet      = getSheet()
  const formats    = getFormats()
  const merge      = getMerge()
  const comments   = getComments()
  const validation = getValidation()
  const condFormat = getCondFormat()
  const sortFilter = getSortFilter()
  const grid       = getGrid()
  if (saved.formats)    formats?.restore(saved.formats)
  if (saved.sheet)      sheet?.restore(unpackSheet(saved.sheet))
  if (saved.merge      && merge?.restore)      merge.restore(saved.merge)
  if (saved.comments   && comments?.restore)   comments.restore(saved.comments)
  if (saved.validation && validation?.restore) validation.restore(saved.validation)
  if (saved.condFormat && condFormat?.restore) condFormat.restore(saved.condFormat)
  if (saved.sortFilter && sortFilter?.restore) sortFilter.restore(saved.sortFilter)
  if (saved.view       && grid?.viewRestore)   grid.viewRestore(saved.view)
  if (title) currentTitle.value = title
  repopulateGrid()
  syncViewMirrors()
  syncNames()
}

// ── composable ─────────────────────────────────────────────────────────────────

export function useVersionHistory({
  sheetId,
  getSheet,
  getFormats,
  getMerge,
  getComments,
  getValidation,
  getCondFormat,
  getSortFilter,
  getGrid,
  currentTitle,
  switchSheet,
  syncNames,
  repopulateGrid,
  syncViewMirrors,
  loadSheet,
  history,
  activeCell,
  _versionsApi = _defaultApi,
}) {
  const vhOpen      = ref(false)
  const vhVersions  = ref([])
  const vhLoading   = ref(false)
  const vhError     = ref('')
  const vhActive    = ref('')
  const vhRestoring = ref(false)
  const vhDiff      = ref(null)
  const vhStepIdx   = ref(null)

  let _vhStash    = null
  let _vhDiffFlat = []

  // Shared engine context forwarded to pure helpers.
  const ctx = {
    getSheet, getFormats, getMerge, getComments, getValidation,
    getCondFormat, getSortFilter, getGrid,
    getCurrentTitle: () => currentTitle.value,
    currentTitle, repopulateGrid, syncViewMirrors, syncNames,
  }

  function _applyState(saved, title) {
    applyEngineState(saved, title, ctx)
  }

  async function _refreshVersions() {
    vhLoading.value = true
    vhError.value   = ''
    try {
      vhVersions.value = await _versionsApi.list(sheetId.value)
    } catch (err) {
      vhError.value = err.message || 'Failed to load versions'
    } finally {
      vhLoading.value = false
    }
  }

  async function openVersionHistory() {
    if (sheetId.value === 'new') return
    vhOpen.value = true
    await _refreshVersions()
  }

  function closeVersionHistory() {
    if (vhActive.value) exitPreview()
    vhOpen.value = false
  }

  async function previewVersion(versionId) {
    if (vhActive.value === versionId) return
    if (!vhActive.value) _vhStash = captureLiveState(ctx)
    vhActive.value  = versionId
    vhDiff.value    = null
    vhStepIdx.value = null
    _vhDiffFlat     = []
    const grid = getGrid()
    grid?.setDiffOverlay?.(null)
    try {
      const state = await _versionsApi.getState(sheetId.value, versionId)
      _applyState(JSON.parse(state.sheets_data || '{}'), state.title)
      try {
        const diff = await _versionsApi.cellDiff(sheetId.value, versionId)
        vhDiff.value = diff
        _vhDiffFlat  = flattenDiff(diff, parseCellId)
        grid?.setDiffOverlay?.(diff?.sheets || null)
        grid?.setActiveDiffSheet?.(getSheet()?.getCurrentSheet())
      } catch (_) { /* highlighting optional */ }
    } catch (err) {
      vhError.value = err.message || 'Failed to load version'
      exitPreview()
    }
  }

  function exitPreview() {
    vhDiff.value    = null
    vhStepIdx.value = null
    _vhDiffFlat     = []
    getGrid()?.setDiffOverlay?.(null)
    if (!_vhStash) { vhActive.value = ''; return }
    _applyState(_vhStash.sheetsData, _vhStash.title)
    _vhStash       = null
    vhActive.value = ''
  }

  function stepPreviewDiff(delta) {
    if (!_vhDiffFlat.length) return
    const cur  = vhStepIdx.value
    const next = cur === null
      ? (delta > 0 ? 0 : _vhDiffFlat.length - 1)
      : (cur + delta + _vhDiffFlat.length) % _vhDiffFlat.length
    vhStepIdx.value = next
    const target = _vhDiffFlat[next]
    if (!target) return
    if (target.sheet && target.sheet !== getSheet()?.getCurrentSheet()) {
      switchSheet(target.sheet)
    }
    activeCell.value = target.id
    const p = parseCellId(target.id)
    if (p) getGrid()?.moveTo?.(p.row, p.col)
  }

  async function restorePreview() {
    if (!vhActive.value) return
    // eslint-disable-next-line no-alert
    if (!window.confirm('Restore this version? A new version will be created representing the restored state.')) return
    vhRestoring.value = true
    try {
      await _versionsApi.restore(sheetId.value, vhActive.value)
      _vhStash       = null
      vhActive.value = ''
      await loadSheet(sheetId.value)
      repopulateGrid()
      syncViewMirrors()
      syncNames()
      history.push()
      await _refreshVersions()
    } catch (err) {
      vhError.value = err.message || 'Restore failed'
    } finally {
      vhRestoring.value = false
    }
  }

  async function nameCurrentPreview() {
    if (!vhActive.value) return
    await nameVersionInline(vhActive.value)
  }

  async function nameVersionInline(versionId) {
    const cur     = vhVersions.value.find(v => v.name === versionId)
    const initial = cur?.version_name || ''
    // eslint-disable-next-line no-alert
    const next    = window.prompt('Name this version', initial)
    if (next === null) return
    const trimmed = next.trim()
    try {
      if (trimmed) await _versionsApi.name(sheetId.value, versionId, trimmed)
      else         await _versionsApi.clearName(sheetId.value, versionId)
      await _refreshVersions()
    } catch (err) {
      vhError.value = err.message || 'Naming failed'
    }
  }

  async function makeACopyInline(versionId) {
    // eslint-disable-next-line no-alert
    const title = window.prompt('Name for the copy', `${currentTitle.value} (snapshot)`)
    if (title === null) return
    try {
      const newName = await _versionsApi.makeACopy(sheetId.value, versionId, title.trim())
      if (newName) {
        // Suite router path (was `/sheets?id=<name>` in the standalone app).
        const url = `${window.location.origin}/sheets/${encodeURIComponent(newName)}`
        window.open(url, '_blank')
      }
    } catch (err) {
      vhError.value = err.message || 'Copy failed'
    }
  }

  async function restoreVersionInline(versionId) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Restore this version? A new version will be created representing the restored state.')) return
    vhRestoring.value  = true
    vhActive.value     = versionId
    try {
      await _versionsApi.restore(sheetId.value, versionId)
      _vhStash       = null
      vhActive.value = ''
      await loadSheet(sheetId.value)
      repopulateGrid()
      syncViewMirrors()
      syncNames()
      history.push()
      await _refreshVersions()
    } catch (err) {
      vhError.value = err.message || 'Restore failed'
    } finally {
      vhRestoring.value = false
    }
  }

  return {
    vhOpen, vhVersions, vhLoading, vhError, vhActive, vhRestoring, vhDiff, vhStepIdx,
    openVersionHistory, closeVersionHistory,
    previewVersion, exitPreview, stepPreviewDiff,
    restorePreview, nameCurrentPreview, nameVersionInline,
    makeACopyInline, restoreVersionInline,
  }
}
