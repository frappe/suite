import { ref } from 'vue'

import { api, client } from '@/api'

interface WorkspaceInfo {
  workspace_name: string
  workspace_logo: string
}

// The server page sets the boot globals; the Vite dev page does not.
const hasServerBoot = typeof window.suite_is_onboarded !== 'undefined'

const workspaceName = ref(window.suite_workspace_name ?? '')
const workspaceLogo = ref(window.suite_workspace_logo ?? '')

function setWorkspace(data: WorkspaceInfo) {
  workspaceName.value = data.workspace_name
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

export function useWorkspace() {
  ensureWorkspaceLoaded()
  return { workspaceName, workspaceLogo, setWorkspace }
}
