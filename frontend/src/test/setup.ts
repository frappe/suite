import 'fake-indexeddb/auto'

import { format } from '@/platform/translation/format'

Object.assign(globalThis, { __: format })
