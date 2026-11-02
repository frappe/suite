import { isBundleAsset } from '@/apps/slides/utils/slidesRequests'

const loaded = new Set<string>()

// the timeline drops entries past its buffer, an observer started early sees them all
export function trackLoadedAssets() {
  if (typeof PerformanceObserver === 'undefined') return

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const url = new URL(entry.name)

      if (url.origin === location.origin && isBundleAsset(url)) {
        loaded.add(url.pathname)
      }
    }
  }).observe({ type: 'resource', buffered: true })
}

export function loadedAssets(): string[] {
  return [...loaded]
}
