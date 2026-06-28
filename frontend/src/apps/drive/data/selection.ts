import { ref } from 'vue'

export const activeEntity = ref<Record<string, unknown> | null>(null)

export function setActiveEntity(entity: Record<string, unknown> | null) {
  activeEntity.value = entity
}
