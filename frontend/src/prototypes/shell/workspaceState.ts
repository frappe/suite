// PROTOTYPE — remove. The picked workspace, shared between the switcher in the
// sidebar and the areas that show a workspace's data. Module scope, so both
// sides read one ref without a prop threaded through the shell.
import { computed, ref } from 'vue'

import { WORKSPACES, type WorkspaceId } from './fixtures'

export const workspaceId = ref<WorkspaceId>(WORKSPACES[0].id)

/** The picked workspace itself. The rail draws its mark, the switcher its name. */
export const currentWorkspace = computed(
  () => WORKSPACES.find((w) => w.id === workspaceId.value) ?? WORKSPACES[0],
)

/** The personal workspace is one person, so it wears their face, not a mark. */
export const isPersonalWorkspace = computed(() => workspaceId.value === 'personal')
