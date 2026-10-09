import { toast } from 'frappe-ui'
import { ref } from 'vue'

import { translate } from '@/platform/translation'

const BUILD = Number(__SUITE_BUILD__)

const minBuilds = ref<Record<string, string>>({})

/** A product turns read-only in tabs older than its minimum build. */
export const belowMinBuild = (product: string) => BUILD < Number(minBuilds.value[product] ?? 0)

let shown: string | null = null

// Reload stays the person's choice, so a page still served stale can't loop
function showBanner(paused: string[] = []) {
  const state = paused.join()
  if (shown !== null && shown.length >= state.length) return

  shown = state
  const products = paused.map((product) => product[0].toUpperCase() + product.slice(1))
  const description = products.length
    ? translate('Reload to keep editing in {0}.', [products.join(', ')])
    : undefined
  const reload = {
    label: translate('Reload'),
    onClick: () => window.location.reload(),
  }
  const options = {
    id: 'suite-newer-build',
    duration: Infinity,
    description,
    action: reload,
  }
  toast.info(translate('A newer version is available'), options)
}

function readHeaders(headers: Headers) {
  const min = headers.get('X-Suite-Min-Builds')
  if (min) {
    minBuilds.value = JSON.parse(min)
  }

  const paused = Object.keys(minBuilds.value).filter(belowMinBuild)
  if (paused.length) {
    showBanner(paused)
  } else if (Number(headers.get('X-Suite-Build')) > BUILD) {
    showBanner()
  }
}

export function watchBuild() {
  if (import.meta.env.DEV) return

  const fetch = window.fetch
  window.fetch = async (...args) => {
    const response = await fetch(...args)
    readHeaders(response.headers)
    return response
  }

  // A chunk of an older build is gone from the server
  const offerReload = (event: Event) => {
    event.preventDefault()
    showBanner()
  }
  window.addEventListener('vite:preloadError', offerReload)
}
