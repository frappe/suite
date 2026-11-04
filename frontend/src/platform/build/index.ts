import { toast } from 'frappe-ui'
import { ref } from 'vue'

import { translate } from '@/platform/translation'

const PAGE_BUILD = Number(__SUITE_BUILD__)

const minBuilds = ref<Record<string, string>>({})

/** A product turns read-only in tabs older than its minimum build. */
export function belowMinBuild(product: string) {
  return PAGE_BUILD < Number(minBuilds.value[product] ?? 0)
}

// The products the shown banner names; null until it shows
let namedProducts: ReadonlySet<string> | null = null

function productLabel(product: string) {
  const labelMap: Record<string, string> = {
    calendar: translate('Calendar'),
    drive: translate('Drive'),
    mail: translate('Mail'),
    meet: translate('Meet'),
    sheets: translate('Sheets'),
    slides: translate('Slides'),
    writer: translate('Writer'),
  }
  return labelMap[product] ?? product[0].toUpperCase() + product.slice(1)
}

// Reload stays the person's choice, so a page still served stale can't loop;
// the banner shows again only to name a product it didn't name yet
function showBanner(pausedProducts: string[] = []) {
  const hasNewProduct = pausedProducts.some((product) => !namedProducts?.has(product))
  if (namedProducts && !hasNewProduct) return

  namedProducts = new Set(pausedProducts)
  const productLabels = pausedProducts.map(productLabel)
  let description: string | undefined
  if (productLabels.length) {
    description = translate('Reload to keep editing in {0}.', [productLabels.join(', ')])
  }

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

// Each product's minimum build; a header that isn't a map of builds is ignored
function parseMinBuilds(header: string): Record<string, string> | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(header)
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const builds: Record<string, string> = {}
  for (const [product, build] of Object.entries(parsed)) {
    if (typeof build === 'string' || typeof build === 'number') {
      builds[product] = String(build)
    }
  }

  return builds
}

function toUrl(input: RequestInfo | URL) {
  if (input instanceof Request) {
    return new URL(input.url)
  }

  return new URL(input, window.location.href)
}

function isSameOrigin(input: RequestInfo | URL) {
  const url = toUrl(input)
  return url.origin === window.location.origin
}

function readHeaders(headers: Headers) {
  const minBuildsHeader = headers.get('X-Suite-Min-Builds')
  const parsedMinBuilds = minBuildsHeader && parseMinBuilds(minBuildsHeader)
  if (parsedMinBuilds) {
    minBuilds.value = parsedMinBuilds
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
  async function fetchReadingBuild(...args: Parameters<typeof fetch>) {
    const response = await originalFetch(...args)
    if (isSameOrigin(args[0])) {
      readHeaders(response.headers)
    }

    return response
  }

  window.fetch = fetchReadingBuild

  // A chunk of an older build is gone from the server
  function offerReload(event: Event) {
    event.preventDefault()
    showBanner()
  }

  window.addEventListener('vite:preloadError', offerReload)
}
