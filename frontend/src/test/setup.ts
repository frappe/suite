import 'fake-indexeddb/auto'

import { format } from '@/platform/translation/format'

Object.assign(globalThis, { __: format })

// jsdom doesn't lay anything out, so nothing ever resizes
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
