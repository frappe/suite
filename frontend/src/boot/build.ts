import { ref } from 'vue'
import { toast } from 'frappe-ui'

import { translate } from '@/boot/translation'

const BUILD = Number(__SUITE_BUILD__)

/** True once the server runs a newer build than this tab, or a chunk failed to load. */
export const staleBuild = ref(false)

const minBuilds = ref<Record<string, string>>({})

/** A product turns read-only in tabs older than its minimum build. */
export const belowMinBuild = (product: string) =>
  BUILD < Number(minBuilds.value[product] ?? 0)

let shown: 'newer' | 'paused' | null = null

// Reload stays the person's choice, so a page still served stale can't loop
function showBanner(state: 'newer' | 'paused') {
  staleBuild.value = true
  if (shown === state || shown === 'paused') return
  shown = state
  toast.info(translate('A newer version is available'), {
    id: 'suite-newer-build',
    duration: Infinity,
    description: state === 'paused' ? translate('Reload to keep editing.') : undefined,
    action: { label: translate('Reload'), onClick: () => window.location.reload() },
  })
}

function readHeaders(headers: Headers) {
  const min = headers.get('X-Suite-Min-Builds')
  if (min) minBuilds.value = JSON.parse(min)
  if (Object.keys(minBuilds.value).some(belowMinBuild)) showBanner('paused')
  else if (Number(headers.get('X-Suite-Build')) > BUILD) showBanner('newer')
}

export function watchBuild() {
  if (import.meta.env.DEV) return
  const fetch = window.fetch
  window.fetch = async (...args) => {
    const response = await fetch(...args)
    readHeaders(response.headers)
    return response
  }
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    showBanner('newer')
  })
}
