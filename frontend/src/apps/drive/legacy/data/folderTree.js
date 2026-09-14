import { computed, reactive, ref } from 'vue'
import { frappeRequest } from 'frappe-ui'
import { prettyData, sortEntities } from '@/apps/drive/utils/files'

export const expandedFolders = ref(new Set())
export const folderChildren = reactive({})

// Skeleton rows shown while a subtree loads, so a huge folder doesn't flood the DOM.
export const MAX_SKELETONS = 20

export const loadedChildRows = computed(() =>
  Object.values(folderChildren).flatMap((node) => node.rows)
)

// Guards against an earlier fetch of the same folder resolving after a later one.
const tokens = {}

async function fetchChildren(name, sortOrder) {
  const node = folderChildren[name]
  const token = (tokens[name] = (tokens[name] || 0) + 1)
  node.loading = true
  let rows = []
  try {
    const data = await frappeRequest({
      url: '/api/method/suite.drive.api.list.files',
      method: 'GET',
      params: {
        team: '',
        entity_name: name,
        order_by: sortOrder?.field || 'modified',
        ascending: sortOrder?.ascending ?? false,
      },
      credentials: 'include',
    })
    const list = Array.isArray(data) ? data : (data?.message ?? [])
    rows = sortEntities(
      prettyData(list.filter((k) => !k.file_name?.startsWith('.'))),
      sortOrder
    )
  } catch {
    rows = []
  }
  if (tokens[name] !== token || !folderChildren[name]) return
  folderChildren[name].rows = rows
  folderChildren[name].loading = false
}

function descendants(name, acc = []) {
  for (const row of folderChildren[name]?.rows ?? []) {
    acc.push(row.name)
    if (folderChildren[row.name]) descendants(row.name, acc)
  }
  return acc
}

// Returns the names dropped from view, so the caller can deselect them.
export function toggleFolder(row, sortOrder) {
  const next = new Set(expandedFolders.value)
  let collapsed = []
  if (next.has(row.name)) {
    collapsed = descendants(row.name)
    for (const name of [row.name, ...collapsed]) {
      next.delete(name)
      delete folderChildren[name]
    }
  } else {
    next.add(row.name)
    if (!folderChildren[row.name]) {
      folderChildren[row.name] = { rows: [], loading: true }
      fetchChildren(row.name, sortOrder)
    }
  }
  expandedFolders.value = next
  return collapsed
}

export function refreshFolder(name, sortOrder) {
  if (folderChildren[name]) fetchChildren(name, sortOrder)
}

export function refreshExpanded(sortOrder) {
  Object.keys(folderChildren).forEach((name) => fetchChildren(name, sortOrder))
}

export function removeFromTree(names) {
  Object.values(folderChildren).forEach((node) => {
    node.rows = node.rows.filter(({ name }) => !names.includes(name))
  })
}

export function resetTree() {
  expandedFolders.value = new Set()
  Object.keys(folderChildren).forEach((name) => delete folderChildren[name])
}

// Rows of an expanded folder render inline under it, so a flat list of rows
// becomes a depth-tagged sequence. Keys are path-based: the same entity can
// legitimately appear at two depths (e.g. a folder and its child both matching
// in Favourites).
export function flattenRows(rows, depth = 0, parentKey = '', out = []) {
  for (const row of rows) {
    const key = parentKey ? `${parentKey}>${row.name}` : row.name
    out.push({ row, depth, key })
    if (!row.is_folder || !expandedFolders.value.has(row.name)) continue
    const node = folderChildren[row.name]
    if (node?.loading)
      for (let i = 0; i < Math.min(row.child_count || 1, MAX_SKELETONS); i++)
        out.push({ placeholder: 'loading', depth: depth + 1, key: `${key}:loading:${i}` })
    else if (!node?.rows.length)
      out.push({ placeholder: 'empty', depth: depth + 1, key: `${key}:empty` })
    else flattenRows(node.rows, depth + 1, key, out)
  }
  return out
}
