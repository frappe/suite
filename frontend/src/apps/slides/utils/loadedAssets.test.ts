import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, expect, it, vi } from 'vitest'

import { loadedAssets, trackLoadedAssets } from '@/apps/slides/utils/loadedAssets'

const chunk = '/assets/suite/frontend/assets/chunk-abc123.js'

// The browser calls the observer with each batch of resource entries it times
function observeEntries(names: string[]) {
  let report: PerformanceObserverCallback = () => {}
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      constructor(callback: PerformanceObserverCallback) {
        report = callback
      }

      observe() {}
    },
  )
  trackLoadedAssets()
  const list = { getEntries: () => names.map((name) => fromPartial<PerformanceEntry>({ name })) }
  report(fromPartial(list), fromPartial({}))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('reads past an entry with no address, as an empty url("") in a style gives', () => {
  expect(() => observeEntries(['', `${location.origin}${chunk}`])).not.toThrow()

  expect(loadedAssets()).toContain(chunk)
})

it('reads entries in a browser without URL.canParse, as Safari before 17', () => {
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { canParse: undefined }))

  expect(() => observeEntries(['', `${location.origin}${chunk}`])).not.toThrow()
  expect(loadedAssets()).toContain(chunk)
})
