import { ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'

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
  const order = sortOrders.value[scopeId]
  // Temporary: saved before Name/Type sorts were fixed to use real fields
  if (order?.field === 'title') order.field = 'file_name'
  if (order?.field === 'mime_type') order.field = 'file_type'
  return order
}

export function setSortOrder(scopeId: string, order: SortOrder) {
  sortOrders.value = { ...sortOrders.value, [scopeId]: order }
  setJson('sortOrder', sortOrders.value)
}

/** Sidebar collapsed on desktop. */
export const sidebarCollapsed = useStorage('isSidebarCollapsed', false)

/** Shared page: site files vs shared-with-you (in-memory only). */
export const shareView = ref(false)
