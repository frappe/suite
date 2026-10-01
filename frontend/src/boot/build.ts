import { ref } from 'vue'
import { toast } from 'frappe-ui'

import { translate } from '@/boot/translation'

const BUILD = Number(__SUITE_BUILD__)

const minBuilds = ref<Record<string, string>>({})

/** A product turns read-only in tabs older than its minimum build. */
export const belowMinBuild = (product: string) =>
  BUILD < Number(minBuilds.value[product] ?? 0)

let shown: string | null = null

// Reload stays the person's choice, so a page still served stale can't loop
function showBanner(paused: string[] = []) {
  const state = paused.join()
  if (shown !== null && shown.length >= state.length) return
  shown = state
  const products = paused.map((product) => product[0].toUpperCase() + product.slice(1))
  toast.info(translate('A newer version is available'), {
    id: 'suite-newer-build',
    duration: Infinity,
    description: products.length
      ? translate('Reload to keep editing in {0}.', [products.join(', ')])
      : undefined,
    action: { label: translate('Reload'), onClick: () => window.location.reload() },
  })
}

function readHeaders(headers: Headers) {
  const min = headers.get('X-Suite-Min-Builds')
  if (min) minBuilds.value = JSON.parse(min)
  const paused = Object.keys(minBuilds.value).filter(belowMinBuild)
  if (paused.length) showBanner(paused)
  else if (Number(headers.get('X-Suite-Build')) > BUILD) showBanner()
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
    showBanner()
  })
}
