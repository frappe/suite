import { ref } from 'vue'

import { api, client } from '@/api'

interface WorkspaceInfo {
  workspace_name: string
  workspace_logo: string
}

// The server page sets the boot globals; the Vite dev page does not.
const hasServerBoot = window.suite_workspace_name !== undefined

const workspaceName = ref(window.suite_workspace_name?.trim() ?? '')
const workspaceLogo = ref(window.suite_workspace_logo ?? '')

function setWorkspace(data: WorkspaceInfo) {
  workspaceName.value = data.workspace_name.trim()
  workspaceLogo.value = data.workspace_logo
}

let devFetchStarted = false

function ensureWorkspaceLoaded() {
  // Prod seeds the refs from boot globals; only dev fetches.
  if (hasServerBoot || devFetchStarted) return
  devFetchStarted = true
  void client
    .query(api.suite.site.get)
    .then(setWorkspace)
    .catch(() => {
      devFetchStarted = false
    })
}

/**
 * The workspace's name and logo, the one owner of both. Settings writes them
 * through `setWorkspace`; every reader updates at once.
 */
export function useWorkspace() {
  ensureWorkspaceLoaded()
  return { workspaceName, workspaceLogo, setWorkspace }
}
