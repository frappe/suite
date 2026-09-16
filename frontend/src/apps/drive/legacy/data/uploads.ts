import { computed, ref } from 'vue'

export const uploads = ref<Array<Record<string, unknown>>>([])

export const uploadsInProgress = computed(() =>
  uploads.value.filter((u) => !u.completed && !u.error),
)
export const uploadsCompleted = computed(() =>
  uploads.value.filter((u) => u.completed && !u.error),
)
export const uploadsFailed = computed(() => uploads.value.filter((u) => u.error))

export function addUpload(payload: Record<string, unknown>) {
  uploads.value.push(payload)
}

export function updateUpload(payload: Record<string, unknown> & { uuid: string }) {
  const idx = uploads.value.findIndex((u) => u.uuid === payload.uuid)
  if (idx > -1) {
    uploads.value[idx] = { ...uploads.value[idx], ...payload }
  }
}

export function clearUploads() {
  uploads.value = []
}
