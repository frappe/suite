import type { OwnerRegistration } from '@/platform/server-state'

const effects = {
  document_settings: { invalidates: ['document', 'drive.node_versions', 'drive.view_list'] },
  convert_version: 'none',
} as const

export const registration: OwnerRegistration = {
  policy(reference) {
    if (reference.kind === 'query') return {}
    const effect = Object.entries(effects).find(([id]) => id === reference.id)?.[1]
    if (!effect) throw new TypeError(`Missing writer effects: ${reference.id}`)
    return { effects: effect }
  },
}
