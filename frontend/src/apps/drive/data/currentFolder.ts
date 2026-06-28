import { ref } from 'vue'

export type CurrentFolder = {
  name: string
  team: string
  entities: Record<string, unknown>[]
}

export const currentFolder = ref<CurrentFolder>({
  name: '',
  team: '',
  entities: [],
})

export function setCurrentFolder(
  payload: Partial<CurrentFolder> | null,
) {
  if (payload === null) {
    currentFolder.value = { name: '', team: '', entities: [] }
    return
  }
  currentFolder.value = { ...currentFolder.value, ...payload }
}
