import { ref } from 'vue'
import { createResource } from 'frappe-ui'

import { hasServerBoot } from '@/boot/session'

interface WorkspaceInfo {
  workspace_name: string
  workspace_logo: string
}

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
  createResource({ url: 'suite.api.account.get_workspace', auto: true, onSuccess: setWorkspace })
}

export function useWorkspace() {
  ensureWorkspaceLoaded()
  return { workspaceName, workspaceLogo, setWorkspace }
}
