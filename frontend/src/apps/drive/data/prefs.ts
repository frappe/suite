import { ref, watch } from 'vue'

export type ViewMode = 'list' | 'grid'

export type SortOrder = {
  label: string
  field: string
  ascending: boolean
  smart?: boolean
}

function getJson<T>(key: string, initial: T): T {
  try {
    return JSON.parse(localStorage.getItem(key)!) ?? initial
  } catch {
    return initial
  }
}

function setJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

/** List vs grid layout — persisted per browser. */
export const view = ref<ViewMode>(getJson('view', 'list'))
watch(view, (v) => setJson('view', v))

/** Sort order keyed by folder / route scope id. */
export const sortOrders = ref<Record<string, SortOrder>>(getJson('sortOrder', {}))

export function getSortOrder(scopeId: string): SortOrder | undefined {
  return sortOrders.value[scopeId]
}

export function setSortOrder(scopeId: string, order: SortOrder) {
  sortOrders.value = { ...sortOrders.value, [scopeId]: order }
  setJson('sortOrder', sortOrders.value)
}

/** Sidebar collapsed on desktop. */
export const sidebarCollapsed = ref(getJson('sidebarCollapsed', false))
watch(sidebarCollapsed, (v) => setJson('sidebarCollapsed', v))

/** Shared page: site files vs shared-with-you (in-memory only). */
export const shareView = ref(false)
