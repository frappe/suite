import { isBundleAsset } from '@/apps/slides/utils/slidesRequests'

const loaded = new Set<string>()

// the timeline drops entries past its buffer, an observer started early sees them all
export function trackLoadedAssets() {
  if (typeof PerformanceObserver === 'undefined') return

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const url = parsedUrl(entry.name)
      if (url && url.origin === location.origin && isBundleAsset(url)) {
        loaded.add(url.pathname)
      }
    }
  }).observe({ type: 'resource', buffered: true })
}

// a style's empty url("") is timed under no address. URL.canParse would say so, but Safari has it
// only from 17.
function parsedUrl(name: string): URL | undefined {
  try {
    return new URL(name)
  } catch {
    return undefined
  }
}

export function loadedAssets(): string[] {
  return [...loaded]
}
