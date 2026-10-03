// The picked workspace, shared between the switcher in the top bar and the
// areas that show a workspace's data. Module scope, so both sides read one
// ref without a prop threaded through the shell.
import { computed, ref } from 'vue'

import { WORKSPACES, type Workspace, type WorkspaceId } from './fixtures'

// A list rather than the fixture const: the switcher's "New workspace" is
// meant to grow it once that flow is decided.
export const workspaces = ref<Workspace[]>([...WORKSPACES])

export const workspaceId = ref<WorkspaceId>(workspaces.value[0].id)

/** The picked workspace itself. The switcher draws its mark and its name. */
export const currentWorkspace = computed(
  () => workspaces.value.find((w) => w.id === workspaceId.value) ?? workspaces.value[0],
)
