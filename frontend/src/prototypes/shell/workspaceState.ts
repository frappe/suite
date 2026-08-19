// PROTOTYPE — remove. The picked workspace, shared between the switcher in the
// sidebar and the areas that show a workspace's data. Module scope, so both
// sides read one ref without a prop threaded through the shell.
import { ref } from 'vue'

import { WORKSPACES, type WorkspaceId } from './fixtures'

export const workspaceId = ref<WorkspaceId>(WORKSPACES[0].id)
