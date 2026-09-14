import { ref } from 'vue'

const filtersByScope = new Map()

export function getPageFilters(scope) {
  if (!filtersByScope.has(scope)) filtersByScope.set(scope, ref([]))
  return filtersByScope.get(scope)
}
