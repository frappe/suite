import { toast } from 'frappe-ui'
import { ref } from 'vue'

import { translate } from '@/platform/translation'

const PAGE_BUILD = Number(__SUITE_BUILD__)

const minBuilds = ref<Record<string, string>>({})

/** A product turns read-only in tabs older than its minimum build. */
export const belowMinBuild = (product: string) => PAGE_BUILD < Number(minBuilds.value[product] ?? 0)

let shownBannerKey: string | null = null

// Reload stays the person's choice, so a page still served stale can't loop
function showBanner(pausedProducts: string[] = []) {
  const bannerKey = pausedProducts.join()
  if (shownBannerKey !== null && shownBannerKey.length >= bannerKey.length) return

  shownBannerKey = bannerKey
  const productLabels = pausedProducts.map((product) => product[0].toUpperCase() + product.slice(1))
  const description = productLabels.length
    ? translate('Reload to keep editing in {0}.', [productLabels.join(', ')])
    : undefined
  const reloadAction = {
    label: translate('Reload'),
    onClick: () => window.location.reload(),
  }
  const options = {
    id: 'suite-newer-build',
    duration: Infinity,
    description,
    action: reloadAction,
  }
  toast.info(translate('A newer version is available'), options)
}

function readHeaders(headers: Headers) {
  const minBuildsHeader = headers.get('X-Suite-Min-Builds')
  if (minBuildsHeader) {
    minBuilds.value = JSON.parse(minBuildsHeader)
  }

  const pausedProducts = Object.keys(minBuilds.value).filter(belowMinBuild)
  if (pausedProducts.length) {
    showBanner(pausedProducts)
  } else if (Number(headers.get('X-Suite-Build')) > PAGE_BUILD) {
    showBanner()
  }
}

export function watchBuild() {
  if (import.meta.env.DEV) return

  const originalFetch = window.fetch
  window.fetch = async (...args) => {
    const response = await originalFetch(...args)
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
