import { ref } from 'vue'

export const activeEntity = ref<Record<string, unknown> | null>(null)

export function setActiveEntity(entity: Record<string, unknown> | null) {
  activeEntity.value = entity
}

// Name of the entity currently being renamed inline in the list view; null when
// no rename is in progress.
export const renamingEntity = ref<string | null>(null)

export function startRename(name: string | null) {
  renamingEntity.value = name
}

export function stopRename() {
  renamingEntity.value = null
}
